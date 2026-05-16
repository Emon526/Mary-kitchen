from rest_framework import serializers
from core.validators import validate_image_file
from .models import StoreProfile


class StoreProfileSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    logo = serializers.ImageField(
        write_only=True,
        required=False,
        allow_null=True,
        validators=[validate_image_file],
    )

    class Meta:
        model = StoreProfile
        fields = [
            "id", "name", "tagline", "email", "phone",
            "address", "suburb", "state", "postcode",
            "latitude", "longitude",
            "logo", "logo_url",
            "description", "opening_hours",
            "website", "facebook", "instagram",
            "updated_at",
        ]

    def get_logo_url(self, obj):
        if not obj.logo:
            return None
        request = self.context.get("request")
        if request:
            return request.build_absolute_uri(obj.logo.url)
        return obj.logo.url
