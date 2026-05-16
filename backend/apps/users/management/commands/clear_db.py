"""
Management command: clear_db

Truncates all application data while preserving superuser accounts.

Usage:
    python manage.py clear_db
    python manage.py clear_db --yes   # skip the confirmation prompt
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import connection, transaction

User = get_user_model()

# Tables to TRUNCATE completely (CASCADE handles child rows automatically).
# Listed in dependency order — children before parents — as a safety net
# even though CASCADE takes care of it.
TRUNCATE_TABLES = [
    # Django internals
    "django_admin_log",
    "django_session",
    # Auth axes (login attempt log)
    "axes_accessattempt",
    "axes_accessattemptexpiration",
    "axes_accessfailurelog",
    "axes_accesslog",
    # JWT token blacklist
    "token_blacklist_blacklistedtoken",
    "token_blacklist_outstandingtoken",
    # Analytics
    "analytics_visits",
    # Banners
    "banners",
    # Store profile
    "store_profile",
    # Reviews
    "reviews",
    # Notifications
    "notifications",
    # Payments
    "payments",
    # Orders (children first)
    "order_status_history",
    "order_items",
    "orders",
    # Cart
    "cart_items",
    "carts",
    # Delivery
    "delivery_zones",
    # Products (children first)
    "product_images",
    "product_variants",
    "attribute_definitions",
    "products",
    "categories",
]

# Tables that contain per-user rows — delete only non-admin user rows.
# wishlists CASCADE-deletes wishlist_items, so we only need the parent.
USER_LINKED_TABLES = [
    ("otp_codes",      "user_id"),
    ("user_addresses", "user_id"),
    ("wishlists",      "user_id"),   # cascades to wishlist_items
]


class Command(BaseCommand):
    help = "Wipe all app data, keeping superuser accounts intact."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes", action="store_true",
            help="Skip the confirmation prompt.",
        )

    def handle(self, *args, **options):
        if not options["yes"]:
            self.stdout.write(self.style.WARNING(
                "\nThis will DELETE all data except superuser accounts.\n"
                "Type 'yes' to continue: "
            ), ending="")
            answer = input().strip().lower()
            if answer != "yes":
                self.stdout.write("Aborted.")
                return

        admin_ids = list(
            User.objects.filter(is_superuser=True).values_list("id", flat=True)
        )
        if not admin_ids:
            self.stdout.write(self.style.WARNING(
                "No superusers found — all users will be deleted too."
            ))

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL DEFERRED;")

                for table in TRUNCATE_TABLES:
                    try:
                        cursor.execute(
                            f'TRUNCATE TABLE "{table}" RESTART IDENTITY CASCADE;'
                        )
                        self.stdout.write(f"  truncated  {table}")
                    except Exception as exc:
                        self.stdout.write(
                            self.style.WARNING(f"  skipped    {table}: {exc}")
                        )

                # Remove non-admin rows from user-linked tables.
                for table, col in USER_LINKED_TABLES:
                    if admin_ids:
                        placeholders = ", ".join(["%s"] * len(admin_ids))
                        cursor.execute(
                            f'DELETE FROM "{table}" WHERE "{col}" NOT IN ({placeholders});',
                            admin_ids,
                        )
                    else:
                        cursor.execute(f'DELETE FROM "{table}";')
                    self.stdout.write(f"  cleared    {table} (non-admin rows)")

                # Delete non-admin users last (addresses/wishlists already gone).
                if admin_ids:
                    placeholders = ", ".join(["%s"] * len(admin_ids))
                    cursor.execute(
                        f'DELETE FROM "users" WHERE "id" NOT IN ({placeholders});',
                        admin_ids,
                    )
                else:
                    cursor.execute('DELETE FROM "users";')
                self.stdout.write("  cleared    users (non-admin accounts)")

        kept = list(User.objects.filter(is_superuser=True).values_list("email", flat=True))
        self.stdout.write(self.style.SUCCESS(
            f"\nDone. Preserved superuser(s): {', '.join(kept) or 'none'}"
        ))
