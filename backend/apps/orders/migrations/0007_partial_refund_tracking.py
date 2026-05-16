from decimal import Decimal
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orders", "0006_order_ready_for_pickup_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="order",
            name="refunded_amount",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=10),
        ),
        migrations.AddField(
            model_name="orderitem",
            name="refunded_quantity",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
