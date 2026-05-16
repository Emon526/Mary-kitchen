from django.db import transaction
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from core.permissions import ADMIN_API_PERMISSION_CLASSES
from .models import StoreProfile
from .serializers import StoreProfileSerializer


def _get_or_create_profile() -> StoreProfile:
    profile = StoreProfile.objects.first()
    if profile is not None:
        return profile
    with transaction.atomic():
        profile = StoreProfile.objects.select_for_update().first()
        if profile is None:
            profile = StoreProfile.objects.create()
    return profile


class StoreProfilePublicView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        profile = _get_or_create_profile()
        serializer = StoreProfileSerializer(profile, context={"request": request})
        return Response(serializer.data)


class AdminStoreProfileView(APIView):
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        profile = _get_or_create_profile()
        serializer = StoreProfileSerializer(profile, context={"request": request})
        return Response(serializer.data)

    def patch(self, request):
        profile = _get_or_create_profile()
        # Ignore remove_logo when a replacement file is being uploaded.
        remove_logo = request.data.get("remove_logo") == "true" and "logo" not in request.FILES
        serializer = StoreProfileSerializer(
            profile,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        old_logo_to_delete = None
        with transaction.atomic():
            instance = serializer.save()
            if remove_logo and instance.logo:
                old_logo_to_delete = instance.logo
                instance.logo = None
                instance.save(update_fields=["logo"])
        # Delete the file after the transaction commits so we never delete a file
        # whose DB nullification was subsequently rolled back.
        if old_logo_to_delete:
            old_logo_to_delete.delete(save=False)
        return Response(StoreProfileSerializer(instance, context={"request": request}).data)
