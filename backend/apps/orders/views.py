"""Order views."""
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import ADMIN_API_PERMISSION_CLASSES, IsOwnerOrAdmin

from .models import Order
from .serializers import (
    AdminOrderSerializer,
    AdminOrderStatusUpdateSerializer,
    CheckoutSerializer,
    OrderSerializer,
)
from .services import create_order_from_cart, update_order_status


class CheckoutView(APIView):
    """POST /api/v1/orders/checkout/ – create order from cart."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            order = create_order_from_cart(
                user=request.user,
                order_type=d["order_type"],
                address_id=d.get("address_id"),
                notes=d.get("notes", ""),
            )
        except ValueError as e:
            return Response({"success": False, "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "success": True,
                "message": "Order created. Proceed to payment.",
                "data": OrderSerializer(order).data,
            },
            status=status.HTTP_201_CREATED,
        )


class OrderListView(generics.ListAPIView):
    """GET /api/v1/orders/ – current user's order history."""
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Order.objects.filter(user=self.request.user)
            .prefetch_related("items", "status_history")
            .order_by("-created_at")
        )


class OrderDetailView(generics.RetrieveAPIView):
    """GET /api/v1/orders/<order_number>/"""
    serializer_class = OrderSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "order_number"

    def get_queryset(self):
        return Order.objects.filter(user=self.request.user).prefetch_related("items", "status_history")


class CancelOrderView(APIView):
    """POST /api/v1/orders/<order_number>/cancel/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, order_number):
        try:
            order = Order.objects.get(order_number=order_number, user=request.user)
        except Order.DoesNotExist:
            return Response({"success": False, "message": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        if order.status not in ["pending", "confirmed"]:
            return Response(
                {"success": False, "message": "Order cannot be cancelled at this stage."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = request.data.get("reason", "")
        order.cancellation_reason = reason
        order = update_order_status(order, "cancelled", request.user, note=f"Cancelled by customer. {reason}")
        return Response({"success": True, "message": "Order cancelled.", "data": OrderSerializer(order).data})


# ─── Admin Views ──────────────────────────────────────────────────────────────

class AdminOrderListView(generics.ListAPIView):
    """Admin: list all orders with filters."""
    serializer_class = AdminOrderSerializer
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    search_fields = ["order_number", "user__email"]
    filterset_fields = ["status", "order_type", "payment_status", "has_out_of_stock_items"]
    ordering_fields = ["created_at", "total_amount"]

    def get_queryset(self):
        return (
            Order.objects.all()
            .select_related("user")
            .prefetch_related("items", "status_history")
            .order_by("-created_at")
        )


class AdminOrderDetailView(generics.RetrieveUpdateAPIView):
    """Admin: view/edit an order."""
    serializer_class = AdminOrderSerializer
    permission_classes = ADMIN_API_PERMISSION_CLASSES
    queryset = Order.objects.all().prefetch_related("items", "status_history")
    lookup_field = "order_number"


class AdminOrderStatusUpdateView(APIView):
    """POST /api/v1/orders/admin/<order_number>/status/"""
    permission_classes = ADMIN_API_PERMISSION_CLASSES

    def post(self, request, order_number):
        try:
            order = Order.objects.get(order_number=order_number)
        except Order.DoesNotExist:
            return Response({"success": False, "message": "Order not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = AdminOrderStatusUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = update_order_status(
            order,
            new_status=serializer.validated_data["status"],
            changed_by=request.user,
            note=serializer.validated_data.get("note", ""),
        )
        return Response({"success": True, "data": AdminOrderSerializer(order).data})
