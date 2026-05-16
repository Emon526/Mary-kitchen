"""Order serializers."""
from rest_framework import serializers

from apps.users.serializers import AddressSerializer
from .models import Order, OrderItem, OrderStatusHistory


class OrderItemSerializer(serializers.ModelSerializer):
    line_total = serializers.ReadOnlyField()
    refundable_quantity = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = [
            "id", "product", "variant", "product_name", "variant_name",
            "unit_price", "quantity", "refunded_quantity", "refundable_quantity",
            "line_total", "was_out_of_stock",
        ]

    def get_refundable_quantity(self, obj):
        return max(0, obj.quantity - obj.refunded_quantity)


class OrderStatusHistorySerializer(serializers.ModelSerializer):
    changed_by_email = serializers.ReadOnlyField(source="changed_by.email")

    class Meta:
        model = OrderStatusHistory
        fields = ["id", "from_status", "to_status", "changed_by_email", "note", "created_at"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    status_history = OrderStatusHistorySerializer(many=True, read_only=True)
    user_email = serializers.ReadOnlyField(source="user.email")
    user_name = serializers.ReadOnlyField(source="user.full_name")

    class Meta:
        model = Order
        fields = [
            "id", "order_number", "status", "order_type",
            "delivery_address", "delivery_zone_name", "delivery_fee", "distance_km",
            "subtotal", "discount_amount", "total_amount", "refunded_amount",
            "payment_status", "stripe_payment_intent_id",
            "has_out_of_stock_items", "notes",
            "estimated_delivery_date", "delivered_at",
            "items", "status_history",
            "user_email", "user_name",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "order_number", "created_at", "updated_at"]


class CheckoutSerializer(serializers.Serializer):
    """Payload for initiating a checkout."""
    order_type = serializers.ChoiceField(choices=["delivery", "pickup"])
    address_id = serializers.UUIDField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    session_id = serializers.CharField(required=False, allow_blank=True, max_length=255)


_ADMIN_UPDATABLE_STATUSES = [s[0] for s in Order.STATUS_CHOICES if s[0] != "refunded"]


class AdminOrderStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=_ADMIN_UPDATABLE_STATUSES)
    note = serializers.CharField(required=False, allow_blank=True)
    force = serializers.BooleanField(required=False, default=False)


class AdminOrderSerializer(OrderSerializer):
    """Extended order serializer for admin with extra fields."""
    class Meta(OrderSerializer.Meta):
        fields = OrderSerializer.Meta.fields + ["admin_notes", "admin_notified_out_of_stock", "cancelled_at", "cancellation_reason"]
        read_only_fields = [*OrderSerializer.Meta.read_only_fields, "status"]
