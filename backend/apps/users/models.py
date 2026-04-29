"""User-related models: custom User, Address, OTP, Wishlist."""
import random
import string
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from core.mixins import BaseModel, TimeStampedModel


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin, BaseModel):
    """Custom user model using email as the login identifier.

    Admin access for the REST API and Django admin is controlled by ``is_staff``
    (and ``is_superuser`` for full Django superuser privileges).
    """
    email = models.EmailField(unique=True, db_index=True)
    first_name = models.CharField(max_length=150)
    last_name = models.CharField(max_length=150)
    phone_number = models.CharField(max_length=20, blank=True, db_index=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)

    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    is_email_verified = models.BooleanField(default=False)
    is_phone_verified = models.BooleanField(default=False)

    date_joined = models.DateTimeField(default=timezone.now)
    last_login = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    objects = UserManager()

    class Meta:
        db_table = "users"
        verbose_name = "User"
        verbose_name_plural = "Users"
        ordering = ["-date_joined"]

    def __str__(self):
        return self.email

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()


class Address(BaseModel):
    """User saved addresses (supports multiple per user)."""
    DARWIN = "NT"
    STATE_CHOICES = [
        ("NSW", "New South Wales"),
        ("VIC", "Victoria"),
        ("QLD", "Queensland"),
        ("WA", "Western Australia"),
        ("SA", "South Australia"),
        ("TAS", "Tasmania"),
        ("NT", "Northern Territory"),
        ("ACT", "Australian Capital Territory"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="addresses")
    label = models.CharField(max_length=50, default="Home", help_text="e.g. Home, Work, Other")
    full_name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, blank=True)
    address_line1 = models.CharField(max_length=255)
    address_line2 = models.CharField(max_length=255, blank=True)
    suburb = models.CharField(max_length=100)
    state = models.CharField(max_length=3, choices=STATE_CHOICES, default=DARWIN)
    postcode = models.CharField(max_length=10)
    country = models.CharField(max_length=50, default="Australia")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        db_table = "user_addresses"
        verbose_name = "Address"
        verbose_name_plural = "Addresses"
        ordering = ["-is_default", "-created_at"]

    def __str__(self):
        return f"{self.label} – {self.address_line1}, {self.suburb} {self.state}"

    def save(self, *args, **kwargs):
        if self.is_default:
            Address.objects.filter(user=self.user, is_default=True).exclude(pk=self.pk).update(
                is_default=False
            )
        super().save(*args, **kwargs)


class OTPCode(TimeStampedModel):
    """One-Time Password for email/phone verification and login."""
    PURPOSE_CHOICES = [
        ("email_verify", "Email Verification"),
        ("phone_verify", "Phone Verification"),
        ("password_reset", "Password Reset"),
        ("otp_login", "OTP Login"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="otp_codes", null=True, blank=True)
    email = models.EmailField(db_index=True)
    code = models.CharField(max_length=10)
    purpose = models.CharField(max_length=20, choices=PURPOSE_CHOICES)
    is_used = models.BooleanField(default=False)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        db_table = "otp_codes"
        indexes = [models.Index(fields=["email", "purpose", "is_used"])]

    def __str__(self):
        return f"{self.email} – {self.purpose} ({self.code})"

    @classmethod
    def generate_code(cls, length=6):
        return "".join(random.choices(string.digits, k=length))

    @property
    def is_expired(self):
        return timezone.now() > self.expires_at

    @property
    def is_valid(self):
        return not self.is_used and not self.is_expired and self.attempts < 5


class Wishlist(BaseModel):
    """User wishlist – products a user has saved for later."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="wishlist")

    class Meta:
        db_table = "wishlists"

    def __str__(self):
        return f"Wishlist of {self.user.email}"


class WishlistItem(BaseModel):
    """Individual item in a wishlist."""
    wishlist = models.ForeignKey(Wishlist, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(
        "products.Product", on_delete=models.CASCADE, related_name="wishlisted_by"
    )

    class Meta:
        db_table = "wishlist_items"
        unique_together = [("wishlist", "product")]

    def __str__(self):
        return f"{self.wishlist.user.email} → {self.product.name}"
