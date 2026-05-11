"""Widen OTPCode.code to 64 chars to store HMAC-SHA256 hex digests."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0002_address_phone_blank"),
    ]

    operations = [
        migrations.AlterField(
            model_name="otpcode",
            name="code",
            field=models.CharField(max_length=64),
        ),
    ]
