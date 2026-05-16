from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("payments", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="stripe_refund_id",
            field=models.CharField(blank=True, default="", max_length=200),
        ),
        migrations.AddField(
            model_name="payment",
            name="refund_reason",
            field=models.TextField(blank=True),
        ),
    ]
