"""
Assign valid compare_price values so the Deals catalog is populated.

Usage:
    cd backend && venv/bin/python manage.py ensure_discounts
    venv/bin/python manage.py ensure_discounts --seed 42

Uses the same backfill logic as the end of `seed_products` (targets ≥35
deals-eligible products: product compare > base OR variant compare > price).
"""
from django.core.management.base import BaseCommand

from apps.products.management.commands.seed_products import backfill_missing_discounts


class Command(BaseCommand):
    help = "Backfill compare_price on products/variants missing valid discounts (testing / Deals page)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--seed",
            type=int,
            default=None,
            help="Optional RNG seed for reproducible compare_price values.",
        )

    def handle(self, *args, **options):
        backfill_missing_discounts(self.stdout, self.style, seed=options["seed"])
