"""Store profile singleton model."""
from django.db import models
from core.mixins import BaseModel


class StoreProfile(BaseModel):
    name = models.CharField(max_length=200, default="Mary Kitchen")
    tagline = models.CharField(max_length=300, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    address = models.TextField(blank=True)
    suburb = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    postcode = models.CharField(max_length=20, blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    logo = models.ImageField(upload_to="store/", null=True, blank=True)
    description = models.TextField(blank=True)
    opening_hours = models.TextField(blank=True, help_text="e.g. Mon–Fri 9am–5pm")
    website = models.URLField(blank=True)
    facebook = models.URLField(blank=True)
    instagram = models.URLField(blank=True)

    class Meta:
        db_table = "store_profile"

    def __str__(self):
        return self.name
