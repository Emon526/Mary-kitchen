"""User app views."""
import logging

from axes.handlers.proxy import AxesProxyHandler
from axes.helpers import get_client_ip_address, get_credentials, get_lockout_message
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import ProtectedError
from rest_framework import generics, serializers, status
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet
from rest_framework_simplejwt.tokens import RefreshToken

from apps.orders.models import Order
from core.otp_rate_limit import consume_otp_request_slot
from core.permissions import ADMIN_API_PERMISSION_CLASSES

from .models import Address, User, Wishlist, WishlistItem
from .serializers import (
    AddressSerializer,
    AdminUserSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    PasswordResetConfirmSerializer,
    UserProfileSerializer,
    UserRegistrationSerializer,
    WishlistSerializer,
)
from .services import send_otp, verify_otp

UserModel = get_user_model()
logger = logging.getLogger(__name__)


class RegisterView(generics.CreateAPIView):
    """POST /api/v1/auth/register/"""
    serializer_class = UserRegistrationSerializer
    permission_classes = [AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            user = serializer.save()

        _, email_sent = send_otp(user.email, "email_verify")

        refresh = RefreshToken.for_user(user)
        message = (
            "Registration successful. Check your email for your verification code."
            if email_sent
            else "Account created. We could not send the verification email right now — "
                 "use 'Resend code' on the verification page to try again."
        )
        return Response({
            "success": True,
            "data": {
                "user": UserProfileSerializer(user).data,
                "tokens": {
                    "refresh": str(refresh),
                    "access": str(refresh.access_token),
                },
            },
            "message": message,
        }, status=status.HTTP_201_CREATED)


class LoginView(APIView):
    """POST /api/v1/auth/login/"""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        password = serializer.validated_data["password"]

        # Resolve client IP the same way Axes does (see AxesProxyHandler.update_request).
        _ = get_client_ip_address(request)

        credentials = get_credentials(username=email, password=password)

        if not AxesProxyHandler.is_allowed(request, credentials):
            return Response(
                {"success": False, "message": get_lockout_message()},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            user = UserModel.objects.get(email=email)
        except UserModel.DoesNotExist:
            user = None

        if user is None or not user.is_active or not user.check_password(password):
            AxesProxyHandler.user_login_failed(
                sender=__name__,
                credentials=credentials,
                request=request,
            )
            return Response(
                {"success": False, "message": "Invalid email or password."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        AxesProxyHandler.user_logged_in(sender=user.__class__, request=request, user=user)

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "success": True,
                "data": {
                    "user": UserProfileSerializer(user).data,
                    "tokens": {
                        "refresh": str(refresh),
                        "access": str(refresh.access_token),
                    },
                },
            }
        )


class LogoutView(APIView):
    """POST /api/v1/auth/logout/ – blacklists the refresh token."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            refresh_token = request.data.get("refresh")
            token = RefreshToken(refresh_token)
            token.blacklist()
            return Response({"success": True, "message": "Logged out successfully."})
        except Exception:
            return Response({"success": False, "message": "Invalid token."}, status=status.HTTP_400_BAD_REQUEST)


class OTPRequestView(APIView):
    """POST /api/v1/auth/otp/request/ – request an OTP."""
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        allowed, rate_msg = consume_otp_request_slot(request, email)
        if not allowed:
            return Response(
                {"success": False, "message": rate_msg},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        _, email_sent = send_otp(**serializer.validated_data)
        return Response({
            "success": True,
            "message": "OTP sent to your email." if email_sent else "Code generated but email could not be sent. Try again later.",
        })


class OTPVerifyView(APIView):
    """POST /api/v1/auth/otp/verify/ – verify an OTP."""
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        email = d["email"]
        credentials = get_credentials(username=email)

        _ = get_client_ip_address(request)

        if not AxesProxyHandler.is_allowed(request, credentials):
            return Response(
                {"error": "Too many failed attempts. Try again later."},
                status=status.HTTP_403_FORBIDDEN,
            )

        success, message = verify_otp(email, d["code"], d["purpose"])

        if not success:
            AxesProxyHandler.user_login_failed(
                sender=__name__,
                credentials=credentials,
                request=request,
            )
            return Response({"success": False, "message": message}, status=status.HTTP_400_BAD_REQUEST)

        response_data = {"success": True, "message": message}

        if d["purpose"] == "email_verify":
            User.objects.filter(email=email).update(is_email_verified=True)
        elif d["purpose"] == "otp_login":
            try:
                user = User.objects.get(email=email)
            except User.DoesNotExist:
                AxesProxyHandler.user_login_failed(
                    sender=__name__,
                    credentials=credentials,
                    request=request,
                )
                return Response({"success": False, "message": "User not found."}, status=status.HTTP_404_NOT_FOUND)

            if not user.is_active:
                return Response(
                    {"success": False, "message": "Account is disabled."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            AxesProxyHandler.user_logged_in(sender=user.__class__, request=request, user=user)

            refresh = RefreshToken.for_user(user)
            response_data["tokens"] = {
                "refresh": str(refresh),
                "access": str(refresh.access_token),
            }
            response_data["user"] = UserProfileSerializer(user).data

        return Response(response_data)


class PasswordResetRequestView(APIView):
    """POST /api/v1/auth/password/reset/ – request password reset OTP."""
    permission_classes = [AllowAny]

    def post(self, request):
        raw_email = request.data.get("email")
        if raw_email is None or str(raw_email).strip() == "":
            return Response({"success": False, "message": "Email is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            email = serializers.EmailField().run_validation(raw_email)
        except serializers.ValidationError:
            return Response({"success": False, "message": "Enter a valid email address."}, status=status.HTTP_400_BAD_REQUEST)

        allowed, rate_msg = consume_otp_request_slot(request, email)
        if not allowed:
            return Response(
                {"success": False, "message": rate_msg},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        if User.objects.filter(email=email).exists():
            send_otp(email, "password_reset")
        return Response({"success": True, "message": "If this email exists, a reset code has been sent."})


class PasswordResetConfirmView(APIView):
    """POST /api/v1/auth/password/reset/confirm/"""
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        success, message = verify_otp(d["email"], d["code"], "password_reset")
        if not success:
            return Response({"success": False, "message": message}, status=status.HTTP_400_BAD_REQUEST)
        try:
            user = User.objects.get(email=d["email"])
            user.set_password(d["new_password"])
            user.save(update_fields=["password"])
            return Response({"success": True, "message": "Password reset successful."})
        except User.DoesNotExist:
            return Response({"success": False, "message": "User not found."}, status=status.HTTP_404_NOT_FOUND)


class UserProfileView(generics.RetrieveUpdateAPIView):
    """GET / PATCH /api/v1/users/profile/"""
    serializer_class = UserProfileSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    """POST /api/v1/users/change-password/"""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"success": True, "message": "Password changed successfully."})


class AddressViewSet(ModelViewSet):
    """CRUD for user addresses."""
    serializer_class = AddressSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Address.objects.filter(user=self.request.user)

    @action(detail=True, methods=["post"])
    def set_default(self, request, pk=None):
        address = self.get_object()
        Address.objects.filter(user=request.user, is_default=True).update(is_default=False)
        address.is_default = True
        address.save(update_fields=["is_default"])
        return Response({"success": True, "message": "Default address updated."})


class WishlistView(generics.RetrieveAPIView):
    """GET /api/v1/users/wishlist/"""
    serializer_class = WishlistSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        wishlist, _ = Wishlist.objects.get_or_create(user=self.request.user)
        return wishlist


class WishlistItemView(APIView):
    """POST /DELETE /api/v1/users/wishlist/items/<product_id>/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, product_id):
        wishlist, _ = Wishlist.objects.get_or_create(user=request.user)
        item, created = WishlistItem.objects.get_or_create(wishlist=wishlist, product_id=product_id)
        if not created:
            return Response({"success": False, "message": "Product already in wishlist."}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"success": True, "message": "Added to wishlist."}, status=status.HTTP_201_CREATED)

    def delete(self, request, product_id):
        wishlist, _ = Wishlist.objects.get_or_create(user=request.user)
        WishlistItem.objects.filter(wishlist=wishlist, product_id=product_id).delete()
        return Response({"success": True, "message": "Removed from wishlist."})


# ─── Admin Views ──────────────────────────────────────────────────────────────

class AdminUserListView(generics.ListAPIView):
    """Admin: list all users."""
    serializer_class = AdminUserSerializer
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    queryset = User.objects.all().order_by("-date_joined")
    search_fields = ["email", "first_name", "last_name", "phone_number"]
    filterset_fields = ["is_active", "is_staff", "is_email_verified"]


class AdminUserDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Admin: view/update/delete user."""
    serializer_class = AdminUserSerializer
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    queryset = User.objects.all()

    def perform_destroy(self, instance):
        if instance.pk == self.request.user.pk:
            raise serializers.ValidationError("You cannot delete your own account.")
        if instance.is_superuser:
            raise serializers.ValidationError("Superuser accounts cannot be deleted via this endpoint.")
        try:
            Order.objects.filter(user=instance).delete()
            instance.delete()
        except ProtectedError as e:
            raise serializers.ValidationError(f"Cannot delete user: {e}")
