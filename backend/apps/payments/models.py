"""Payment records linked to orders."""
from django.db import models
from core.mixins import BaseModel


class Payment(BaseModel):
    """Stores payment attempt data from Stripe."""
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("succeeded", "Succeeded"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
        ("refunded", "Refunded"),
        ("partially_refunded", "Partially Refunded"),
    ]

    order = models.ForeignKey("orders.Order", on_delete=models.CASCADE, related_name="payments")
    user = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="payments")

    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default="AUD")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")

    stripe_payment_intent_id = models.CharField(max_length=200, blank=True, db_index=True)
    stripe_client_secret = models.CharField(max_length=500, blank=True)
    stripe_charge_id = models.CharField(max_length=200, blank=True)
    stripe_refund_id = models.CharField(max_length=200, blank=True, default="")
    refund_reason = models.TextField(blank=True)

    failure_message = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "payments"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Payment {self.stripe_payment_intent_id} – {self.status}"
