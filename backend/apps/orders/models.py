"""Order and OrderItem models with full status flow."""
from decimal import Decimal
from django.db import models
from core.mixins import BaseModel


class Order(BaseModel):
    """A customer order."""
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("confirmed", "Confirmed"),
        ("processing", "Processing"),
        ("out_for_delivery", "Out for Delivery"),
        ("delivered", "Delivered"),
        ("cancelled", "Cancelled"),
        ("refunded", "Refunded"),
    ]
    ORDER_TYPE_CHOICES = [
        ("delivery", "Delivery"),
        ("pickup", "Pickup"),
    ]
    PAYMENT_STATUS_CHOICES = [
        ("unpaid", "Unpaid"),
        ("paid", "Paid"),
        ("refunded", "Refunded"),
        ("partially_refunded", "Partially Refunded"),
        ("failed", "Failed"),
    ]

    user = models.ForeignKey("users.User", on_delete=models.PROTECT, related_name="orders")
    order_number = models.CharField(max_length=20, unique=True, db_index=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending", db_index=True)
    order_type = models.CharField(max_length=10, choices=ORDER_TYPE_CHOICES, default="delivery")

    # Snapshot of delivery address at order time
    delivery_address = models.JSONField(null=True, blank=True)
    delivery_zone_name = models.CharField(max_length=200, blank=True)
    delivery_fee = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    distance_km = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    payment_status = models.CharField(max_length=20, choices=PAYMENT_STATUS_CHOICES, default="unpaid")
    stripe_payment_intent_id = models.CharField(max_length=200, blank=True, db_index=True)
    stripe_checkout_session_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    session_id = models.CharField(max_length=255, null=True, blank=True)

    has_out_of_stock_items = models.BooleanField(default=False)
    admin_notified_out_of_stock = models.BooleanField(default=False)
    confirmation_email_sent = models.BooleanField(default=False)

    notes = models.TextField(blank=True, help_text="Customer notes")
    admin_notes = models.TextField(blank=True, help_text="Internal admin notes")

    estimated_delivery_date = models.DateField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)

    class Meta:
        db_table = "orders"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "status"]),
            models.Index(fields=["status", "created_at"]),
        ]

    def __str__(self):
        return f"Order #{self.order_number} – {self.user.email}"

    def save(self, *args, **kwargs):
        if not self.order_number:
            self.order_number = self._generate_order_number()
        super().save(*args, **kwargs)

    @staticmethod
    def _generate_order_number():
        import random
        import string
        from django.utils import timezone
        prefix = timezone.now().strftime("%Y%m")
        suffix = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
        return f"MK-{prefix}-{suffix}"

    def calculate_totals(self):
        subtotal = sum(item.line_total for item in self.items.all())
        self.subtotal = subtotal
        self.total_amount = subtotal + self.delivery_fee - self.discount_amount
        self.save(update_fields=["subtotal", "total_amount"])


class OrderItem(BaseModel):
    """A line item within an order."""
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey("products.Product", on_delete=models.PROTECT)
    variant = models.ForeignKey("products.ProductVariant", on_delete=models.SET_NULL, null=True, blank=True)

    # Snapshot fields (price may change later)
    product_name = models.CharField(max_length=500)
    variant_name = models.CharField(max_length=200, blank=True)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.PositiveIntegerField()
    was_out_of_stock = models.BooleanField(default=False)

    class Meta:
        db_table = "order_items"

    def __str__(self):
        return f"{self.product_name} × {self.quantity}"

    @property
    def line_total(self):
        return self.unit_price * Decimal(self.quantity)


class OrderStatusHistory(BaseModel):
    """Audit trail of order status changes."""
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="status_history")
    from_status = models.CharField(max_length=20, blank=True)
    to_status = models.CharField(max_length=20)
    changed_by = models.ForeignKey("users.User", on_delete=models.SET_NULL, null=True)
    note = models.TextField(blank=True)

    class Meta:
        db_table = "order_status_history"
        ordering = ["-created_at"]
