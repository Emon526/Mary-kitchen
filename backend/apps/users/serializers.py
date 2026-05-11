"""User app serializers."""
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken

from core.validators import validate_image_file
from .models import Address, OTPCode, User, Wishlist, WishlistItem


class UserRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, validators=[validate_password])
    password_confirm = serializers.CharField(write_only=True)
    tokens = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "phone_number", "password", "password_confirm", "tokens"]

    def validate(self, attrs):
        if "is_staff" in self.initial_data:
            raise serializers.ValidationError({"is_staff": "This field cannot be set via registration."})
        if "is_superuser" in self.initial_data:
            raise serializers.ValidationError({"is_superuser": "This field cannot be set via registration."})
        if attrs["password"] != attrs.pop("password_confirm"):
            raise serializers.ValidationError({"password_confirm": "Passwords do not match."})
        return attrs

    def create(self, validated_data):
        # Never allow privilege escalation via extra kwargs (defense in depth).
        validated_data.pop("is_staff", None)
        validated_data.pop("is_superuser", None)
        validated_data.setdefault("is_staff", False)
        validated_data.setdefault("is_superuser", False)
        user = User.objects.create_user(**validated_data)
        Wishlist.objects.create(user=user)
        return user

    def get_tokens(self, user):
        refresh = RefreshToken.for_user(user)
        return {"refresh": str(refresh), "access": str(refresh.access_token)}


class LoginSerializer(serializers.Serializer):
    """Validates login payload; authentication and Axes tracking happen in ``LoginView``."""

    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class UserProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.ReadOnlyField()

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "full_name",
            "phone_number", "avatar", "is_email_verified", "is_phone_verified",
            "is_staff", "date_joined",
        ]
        read_only_fields = ["id", "email", "is_email_verified", "is_phone_verified", "is_staff", "date_joined"]

    def validate_avatar(self, value):
        return validate_image_file(value)


class AddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = Address
        fields = [
            "id", "label", "full_name", "phone", "address_line1", "address_line2",
            "suburb", "state", "postcode", "country", "latitude", "longitude",
            "is_default", "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def create(self, validated_data):
        validated_data["user"] = self.context["request"].user
        return super().create(validated_data)


class OTPRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    purpose = serializers.ChoiceField(
        choices=["email_verify", "phone_verify", "password_reset", "otp_login"]
    )


class OTPVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=10)
    purpose = serializers.ChoiceField(
        choices=["email_verify", "phone_verify", "password_reset", "otp_login"]
    )


class PasswordResetConfirmSerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(max_length=10)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(write_only=True)

    def validate(self, attrs):
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError({"new_password_confirm": "Passwords do not match."})
        return attrs


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])
    new_password_confirm = serializers.CharField(write_only=True)

    def validate_old_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Old password is incorrect.")
        return value

    def validate(self, attrs):
        if attrs["new_password"] != attrs["new_password_confirm"]:
            raise serializers.ValidationError({"new_password_confirm": "Passwords do not match."})
        return attrs


class WishlistItemSerializer(serializers.ModelSerializer):
    product_name = serializers.ReadOnlyField(source="product.name")
    product_price = serializers.ReadOnlyField(source="product.base_price")
    product_image = serializers.SerializerMethodField()
    product_slug = serializers.ReadOnlyField(source="product.slug")

    class Meta:
        model = WishlistItem
        fields = ["id", "product", "product_name", "product_price", "product_image", "product_slug", "created_at"]
        read_only_fields = ["id", "created_at"]

    def get_product_image(self, obj):
        primary = obj.product.images.filter(is_primary=True).first()
        if primary and primary.image:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(primary.image.url)
        return None


class WishlistSerializer(serializers.ModelSerializer):
    items = WishlistItemSerializer(many=True, read_only=True)

    class Meta:
        model = Wishlist
        fields = ["id", "items"]


class AdminUserSerializer(serializers.ModelSerializer):
    """Serializer for admin user management (staff may PATCH ``is_staff``)."""
    full_name = serializers.ReadOnlyField()
    order_count = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "first_name", "last_name", "full_name",
            "phone_number", "is_active", "is_staff", "is_email_verified",
            "date_joined", "last_login", "order_count",
        ]
        read_only_fields = ["id", "full_name", "order_count", "date_joined", "last_login"]

    def get_order_count(self, obj):
        return obj.orders.count()

    def update(self, instance, validated_data):
        request = self.context.get("request")
        if (
            request
            and instance.pk == request.user.pk
            and validated_data.get("is_staff") is False
        ):
            raise serializers.ValidationError(
                {"is_staff": "You cannot remove your own admin access via this endpoint."}
            )
        return super().update(instance, validated_data)
