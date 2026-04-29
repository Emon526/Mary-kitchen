from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from core.permissions import ADMIN_API_PERMISSION_CLASSES

from .models import DeliveryZone
from .serializers import DeliveryFeeRequestSerializer, DeliveryZoneSerializer
from .services import get_delivery_fee


class DeliveryZoneListView(generics.ListAPIView):
    """GET /api/v1/delivery/zones/ – public list of active zones."""
    serializer_class = DeliveryZoneSerializer
    permission_classes = [AllowAny]
    queryset = DeliveryZone.objects.filter(is_active=True)


class DeliveryFeeView(APIView):
    """POST /api/v1/delivery/calculate-fee/ – calculate delivery fee for coordinates."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = DeliveryFeeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        result = get_delivery_fee(d["latitude"], d["longitude"], d["order_total"])
        if "zone" in result and result["zone"]:
            result["zone"] = DeliveryZoneSerializer(result["zone"]).data
        return Response(result)


class AdminDeliveryZoneViewSet(ModelViewSet):
    """Admin CRUD for delivery zones."""
    serializer_class = DeliveryZoneSerializer
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    queryset = DeliveryZone.objects.all()
