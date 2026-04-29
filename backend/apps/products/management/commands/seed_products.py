"""
Management command: seed_products
Usage:
    venv/bin/python manage.py seed_products           # insert seed data
    venv/bin/python manage.py seed_products --flush   # wipe products first, then seed

After seeding, a backfill pass ensures many products/variants have valid compare_price
so /products/deals/ is populated. For an existing database (no re-seed), run:
    venv/bin/python manage.py ensure_discounts [--seed N]
"""
import io
import random
import uuid
from decimal import Decimal, ROUND_HALF_UP

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

from apps.cart.models import CartItem
from apps.orders.models import Order
from apps.products.models import (
    Category, Product, ProductImage, ProductVariant,
)
from apps.reviews.models import Review
from apps.users.models import WishlistItem

try:
    from PIL import Image as PilImage, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False


# ─── Placeholder image generator ─────────────────────────────────────────────

CATEGORY_COLORS = {
    "Fish & Seafood":    ("#E0F2FE", "#0369A1"),
    "Meat & Poultry":    ("#FEE2E2", "#B91C1C"),
    "Vegetables":        ("#DCFCE7", "#15803D"),
    "Rice & Grains":     ("#FEF9C3", "#A16207"),
    "Oil & Condiments":  ("#FDF4FF", "#7E22CE"),
}


def make_placeholder(label: str, bg_hex: str, fg_hex: str) -> ContentFile:
    """Return a small coloured JPEG as a ContentFile."""
    if not HAS_PILLOW:
        # Minimal 1×1 white JPEG (not pretty but valid)
        data = (
            b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
            b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t'
            b'\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a'
            b'\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\x1e'
            b'BX\xeb\xff\xd9'
        )
        return ContentFile(data, name="placeholder.jpg")

    def hex_to_rgb(h):
        h = h.lstrip("#")
        return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

    bg = hex_to_rgb(bg_hex)
    fg = hex_to_rgb(fg_hex)

    img = PilImage.new("RGB", (300, 300), bg)
    draw = ImageDraw.Draw(img)

    # Draw a simple icon circle
    draw.ellipse([75, 60, 225, 210], fill=fg + (40,) if len(fg) == 3 else fg, outline=fg, width=3)

    # Draw first letters of the label
    initials = "".join(w[0].upper() for w in label.split()[:2])
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 64)
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), initials, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    draw.text(((300 - text_w) // 2, (300 - text_h) // 2 - 10), initials, fill=fg, font=font)

    # Bottom label
    try:
        small_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
    except Exception:
        small_font = ImageFont.load_default()

    short = label[:20]
    sbbox = draw.textbbox((0, 0), short, font=small_font)
    sw = sbbox[2] - sbbox[0]
    draw.text(((300 - sw) // 2, 240), short, fill=fg, font=small_font)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    fname = slugify(label) + ".jpg"
    return ContentFile(buf.getvalue(), name=fname)


# ─── Discount helpers (compare > sale) ───────────────────────────────────────

def _markdown_mult() -> Decimal:
    return Decimal(str(round(random.uniform(1.2, 1.5), 2)))


def _compare_above_sale(sale: Decimal) -> Decimal:
    """Guaranteed compare > sale (was price) for valid discount rows."""
    cp = (sale * _markdown_mult()).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if cp <= sale:
        cp = (sale * Decimal("1.21")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return cp


def resolve_product_compare(base_price, seed_compare):
    """
    Final product compare_price: keep seed if valid (compare > base),
    else ~45% chance assign base * random(1.2–1.5).
    """
    base = Decimal(str(base_price))
    if seed_compare is not None:
        sc = Decimal(str(seed_compare))
        if sc > base:
            return sc
    if random.random() < 0.45:
        return _compare_above_sale(base)
    return None


def maybe_variant_compare(price):
    """~35% chance: variant compare_price = price * random(1.2–1.5)."""
    p = Decimal(str(price))
    if random.random() < 0.35:
        return _compare_above_sale(p)
    return None


def backfill_missing_discounts(stdout, style, seed=None):
    """
    Guarantee a healthy Deals catalog: upgrade products/variants missing a valid
    compare_price until the deals-style queryset has a solid minimum count.
    """
    if seed is not None:
        random.seed(seed)

    from django.db.models import Exists, F, OuterRef, Q

    def deals_qs():
        vd = ProductVariant.objects.filter(
            product_id=OuterRef("pk"),
            is_active=True,
            compare_price__isnull=False,
        ).filter(compare_price__gt=F("price"))
        return Product.objects.filter(is_active=True).filter(
            Q(compare_price__isnull=False, compare_price__gt=F("base_price"))
            | Exists(vd)
        )

    target_min = 35
    p_updates = 0
    v_updates = 0
    max_rounds = 8

    for _ in range(max_rounds):
        if deals_qs().count() >= target_min:
            break
        # Products without a valid product-level discount
        for p in (
            Product.objects.filter(is_active=True)
            .filter(Q(compare_price__isnull=True) | Q(compare_price__lte=F("base_price")))
            .order_by("?")[:25]
        ):
            base = p.base_price
            cp = _compare_above_sale(base)
            p.compare_price = cp
            p.save(update_fields=["compare_price"])
            p_updates += 1
        # Variants still missing variant-level discount
        for v in (
            ProductVariant.objects.filter(is_active=True)
            .filter(Q(compare_price__isnull=True) | Q(compare_price__lte=F("price")))
            .select_related("product")
            .order_by("?")[:40]
        ):
            pr = v.price
            cp = _compare_above_sale(pr)
            v.compare_price = cp
            v.save(update_fields=["compare_price"])
            v_updates += 1

    n_deals = deals_qs().count()
    stdout.write(
        style.SUCCESS(
            f"  Discount backfill: +{p_updates} products, +{v_updates} variants "
            f"(deals-eligible products ≈ {n_deals})."
        )
    )


# ─── Seed data ────────────────────────────────────────────────────────────────

SEED_DATA = {
    "Fish & Seafood": {
        "sort_order": 1,
        "description": "Fresh and frozen fish, prawns, and seafood delivered to your door.",
        "products": [
            # (name, description, base_price, compare_price|None, stock, is_featured, rating, unit, attributes, variants)
            # variants: list of (name, price_delta, stock)
            ("Atlantic Salmon Fillet",
             "Premium fresh Atlantic salmon fillet, skin-on. Rich in omega-3 fatty acids.",
             18.99, 22.99, 45, True, 4.8, "kg",
             {"freshness": "Fresh", "cut": "Fillet"},
             [("500g", 9.99, 30), ("1kg", 18.99, 15), ("2kg", 35.99, 5)]),

            ("King Prawns",
             "Large, succulent king prawns. Perfect for BBQ, stir-fry, or pasta.",
             24.99, None, 60, True, 4.7, "kg",
             {"freshness": "Fresh", "cut": "Whole"},
             [("500g", 12.99, 40), ("1kg", 24.99, 20)]),

            ("Barramundi Fillet",
             "Australian barramundi, mild flavour and flaky white flesh. Wild-caught.",
             16.49, 19.99, 35, False, 4.6, "kg",
             {"freshness": "Fresh", "cut": "Fillet"},
             [("500g", 8.49, 25), ("1kg", 16.49, 10)]),

            ("Tiger Prawns",
             "Succulent tiger prawns, great for curry, tempura, or grilling.",
             27.99, None, 50, False, 4.5, "kg",
             {"freshness": "Frozen", "cut": "Whole"},
             [("500g", 14.99, 30), ("1kg", 27.99, 20)]),

            ("Snapper Whole",
             "Whole fresh snapper, scaled and gutted. Ideal for baking or steaming.",
             14.99, 17.99, 20, False, 4.4, "each",
             {"freshness": "Fresh", "cut": "Whole"},
             [("Small (~500g)", 9.99, 12), ("Large (~1kg)", 14.99, 8)]),

            ("Blue Swimmer Crab",
             "Fresh blue swimmer crabs from Northern Australia. Sweet, tender meat.",
             19.99, None, 25, True, 4.6, "each",
             {"freshness": "Fresh", "cut": "Whole"},
             [("1 Crab (~400g)", 9.99, 15), ("2 Crabs (~800g)", 18.99, 10)]),

            ("Tuna Steak",
             "Sushi-grade yellowfin tuna steak. Ideal for searing or sashimi.",
             32.99, 38.99, 20, True, 4.9, "kg",
             {"freshness": "Fresh", "cut": "Steak"},
             [("300g", 10.99, 12), ("500g", 16.99, 8)]),

            ("Calamari (Squid)",
             "Cleaned and sliced calamari tubes. Ready to cook — fry, grill or braise.",
             11.99, None, 55, False, 4.3, "kg",
             {"freshness": "Fresh", "cut": "Rings"},
             [("500g", 6.49, 35), ("1kg", 11.99, 20)]),

            ("Oysters (Dozen)",
             "Fresh Sydney rock oysters, perfect for entertaining. Served on the half shell.",
             22.99, None, 30, True, 4.8, "dozen",
             {"freshness": "Fresh", "cut": "Half-shell"},
             [("6 pack", 12.99, 20), ("Dozen", 22.99, 10)]),

            ("Frozen Basa Fillet",
             "Mild-flavoured basa fillets, great value. Thaw and cook from frozen.",
             8.99, 10.99, 80, False, 4.0, "kg",
             {"freshness": "Frozen", "cut": "Fillet"},
             [("500g", 4.99, 50), ("1kg", 8.99, 30)]),

            ("Coral Trout Fillet",
             "Premium reef fish with delicate flavour and firm white flesh.",
             29.99, 34.99, 15, False, 4.7, "kg",
             {"freshness": "Fresh", "cut": "Fillet"},
             [("500g", 15.99, 10), ("1kg", 29.99, 5)]),

            ("Sardines (Whole)",
             "Fresh whole sardines, high in omega-3. Great grilled with lemon and garlic.",
             7.49, None, 40, False, 4.2, "kg",
             {"freshness": "Fresh", "cut": "Whole"},
             [("500g", 3.99, 25), ("1kg", 7.49, 15)]),

            ("Mussels (Live)",
             "Live blue mussels, farmed sustainably. Steam with white wine and herbs.",
             9.99, None, 35, False, 4.5, "kg",
             {"freshness": "Fresh", "cut": "Whole"},
             [("500g", 5.49, 20), ("1kg", 9.99, 15)]),

            ("Smoked Salmon",
             "Cold-smoked Atlantic salmon slices. Perfect for bagels, platters, and salads.",
             12.99, None, 60, True, 4.7, "pack",
             {"freshness": "Smoked", "cut": "Sliced"},
             [("100g", 6.49, 40), ("200g", 12.99, 20)]),

            ("Flathead Fillet",
             "Fresh Australian flathead, sweet and tender. A local favourite for fish & chips.",
             17.99, 20.99, 25, False, 4.5, "kg",
             {"freshness": "Fresh", "cut": "Fillet"},
             [("500g", 9.49, 15), ("1kg", 17.99, 10)]),

            ("Lobster Tail (Frozen)",
             "Rock lobster tail, MSC-certified. Thaw, halve and grill with garlic butter.",
             45.99, None, 10, True, 4.9, "each",
             {"freshness": "Frozen", "cut": "Tail"},
             [("200g tail", 22.99, 6), ("400g tail", 45.99, 4)]),

            ("Scallops",
             "Hand-dived sea scallops with roe. Pan-sear in butter for a restaurant finish.",
             26.99, 31.99, 20, False, 4.8, "kg",
             {"freshness": "Fresh", "cut": "Whole"},
             [("250g", 7.99, 12), ("500g", 14.99, 8)]),

            ("Kingfish Fillet",
             "Hiramasa kingfish, farmed in South Australia. Silky texture, great for crudo.",
             28.99, None, 18, False, 4.6, "kg",
             {"freshness": "Fresh", "cut": "Fillet"},
             [("500g", 14.99, 12), ("1kg", 28.99, 6)]),

            ("Octopus (Cleaned)",
             "Whole cleaned octopus, pre-tenderised. Braise low-and-slow or char-grill.",
             15.99, None, 22, False, 4.4, "kg",
             {"freshness": "Fresh", "cut": "Whole"},
             [("500g", 8.49, 15), ("1kg", 15.99, 7)]),

            ("Whiting Fillet",
             "Delicate, thin-skinned whiting. Pan-fry whole or use in fish tacos.",
             13.99, 15.99, 0, False, 4.3, "kg",
             {"freshness": "Fresh", "cut": "Fillet"},
             [("500g", 7.49, 0), ("1kg", 13.99, 0)]),
        ],
    },

    "Meat & Poultry": {
        "sort_order": 2,
        "description": "Premium quality beef, lamb, chicken, and pork from local farms.",
        "products": [
            ("Beef Ribeye Steak",
             "Well-marbled Australian ribeye steak. Best cooked medium-rare on a hot grill.",
             38.99, 44.99, 30, True, 4.9, "kg",
             {"type": "Beef", "cut": "Ribeye"},
             [("250g", 9.99, 20), ("400g", 15.99, 10)]),

            ("Chicken Breast Fillet",
             "Free-range skinless chicken breast. Lean, versatile, great for grilling or baking.",
             12.99, None, 80, True, 4.5, "kg",
             {"type": "Chicken", "cut": "Breast"},
             [("500g", 6.99, 50), ("1kg", 12.99, 30)]),

            ("Lamb Shoulder",
             "Bone-in lamb shoulder from Southern Highlands farms. Slow-roast for 4 hours.",
             22.99, 26.99, 25, False, 4.7, "kg",
             {"type": "Lamb", "cut": "Shoulder"},
             [("1kg", 22.99, 15), ("2kg", 43.99, 10)]),

            ("Pork Belly (Skin-on)",
             "Crispy skin pork belly, ideal for slow roasting or Asian braising.",
             16.99, None, 35, False, 4.6, "kg",
             {"type": "Pork", "cut": "Belly"},
             [("500g", 8.99, 20), ("1kg", 16.99, 15)]),

            ("Beef Mince (Regular)",
             "Freshly ground beef mince, 20% fat. Perfect for bolognese, burgers, and meatballs.",
             10.99, 12.99, 60, False, 4.4, "kg",
             {"type": "Beef", "cut": "Mince"},
             [("500g", 5.99, 40), ("1kg", 10.99, 20)]),

            ("Chicken Thigh Bone-in",
             "Free-range chicken thighs, skin-on, bone-in. Juicy and full of flavour.",
             9.99, None, 70, False, 4.5, "kg",
             {"type": "Chicken", "cut": "Thigh"},
             [("500g", 5.49, 45), ("1kg", 9.99, 25)]),

            ("Lamb Chops",
             "New Zealand lamb loin chops. Quick to cook, tender and full of flavour.",
             28.99, 33.99, 30, True, 4.8, "kg",
             {"type": "Lamb", "cut": "Chops"},
             [("500g", 14.99, 20), ("1kg", 28.99, 10)]),

            ("Beef T-Bone Steak",
             "Classic T-bone with tenderloin and strip steak. The ultimate grill cut.",
             36.99, None, 20, True, 4.8, "each",
             {"type": "Beef", "cut": "T-Bone"},
             [("~400g steak", 16.99, 12), ("~600g steak", 22.99, 8)]),

            ("Whole Chicken",
             "Free-range whole chicken, oven-ready. Roast with lemon, garlic, and herbs.",
             14.99, 17.99, 40, False, 4.6, "each",
             {"type": "Chicken", "cut": "Whole"},
             [("~1.2kg", 12.99, 25), ("~1.8kg", 16.99, 15)]),

            ("Pork Shoulder (Bone-in)",
             "Ideal for low-and-slow pulled pork. Season with smoky dry rub overnight.",
             13.99, None, 30, False, 4.5, "kg",
             {"type": "Pork", "cut": "Shoulder"},
             [("1kg", 13.99, 20), ("2kg", 26.99, 10)]),

            ("Beef Brisket",
             "Whole beef brisket — perfect for BBQ smoking or slow cooker recipes.",
             19.99, 23.99, 20, False, 4.7, "kg",
             {"type": "Beef", "cut": "Brisket"},
             [("1kg", 19.99, 12), ("2kg", 37.99, 8)]),

            ("Duck Breast",
             "French-style Muscovy duck breast with skin. Score, season and pan-sear.",
             24.99, 28.99, 15, True, 4.7, "each",
             {"type": "Duck", "cut": "Breast"},
             [("1 breast ~200g", 12.99, 10), ("2 breasts ~400g", 24.99, 5)]),

            ("Lamb Mince",
             "Freshly minced lamb shoulder. Great for kofta, moussaka, and shepherd's pie.",
             14.99, None, 35, False, 4.5, "kg",
             {"type": "Lamb", "cut": "Mince"},
             [("500g", 7.99, 22), ("1kg", 14.99, 13)]),

            ("Pork Sausages (Thin)",
             "Hand-crafted thin pork sausages with herbs. 6 per pack. BBQ favourite.",
             8.99, 10.99, 55, False, 4.4, "pack",
             {"type": "Pork", "cut": "Sausage"},
             [("6-pack ~400g", 8.99, 35), ("12-pack ~800g", 16.99, 20)]),

            ("Beef Short Ribs",
             "Thick-cut beef short ribs. Braise for 3+ hours until fall-off-the-bone tender.",
             22.99, 27.99, 18, False, 4.6, "kg",
             {"type": "Beef", "cut": "Ribs"},
             [("500g", 11.99, 12), ("1kg", 22.99, 6)]),

            ("Chicken Drumsticks",
             "Free-range chicken drumsticks. Marinate and bake or throw them on the BBQ.",
             7.99, None, 80, False, 4.3, "kg",
             {"type": "Chicken", "cut": "Drumstick"},
             [("500g", 4.49, 50), ("1kg", 7.99, 30)]),

            ("Beef Eye Fillet",
             "The most tender cut of beef. Centre-cut tenderloin, perfect for special occasions.",
             54.99, 62.99, 12, True, 5.0, "kg",
             {"type": "Beef", "cut": "Eye Fillet"},
             [("200g", 11.99, 8), ("400g", 22.99, 4)]),

            ("Spatchcock Chicken",
             "Butterflied spatchcock, skin-on. Season and roast at high heat for crispy skin.",
             13.99, None, 22, False, 4.5, "each",
             {"type": "Chicken", "cut": "Spatchcock"},
             [("~800g bird", 10.99, 15), ("~1.1kg bird", 13.99, 7)]),

            ("Lamb Rack",
             "Premium frenched lamb rack, 8 ribs. Restaurant quality — serve with mint jus.",
             39.99, 46.99, 10, True, 4.9, "each",
             {"type": "Lamb", "cut": "Rack"},
             [("4-rib half rack", 21.99, 6), ("8-rib full rack", 39.99, 4)]),

            ("Veal Osso Buco",
             "Cross-cut veal shanks for the classic Italian braise. Serve with gremolata.",
             27.99, None, 0, False, 4.7, "kg",
             {"type": "Veal", "cut": "Osso Buco"},
             [("~400g slice", 11.99, 0), ("~700g slice", 19.99, 0)]),
        ],
    },

    "Vegetables": {
        "sort_order": 3,
        "description": "Farm-fresh seasonal vegetables, including certified organic options.",
        "products": [
            ("Baby Spinach",
             "Tender baby spinach leaves, triple-washed and ready to eat. Rich in iron.",
             3.99, None, 100, False, 4.5, "pack",
             {"organic": True, "source": "Victoria"},
             [("120g bag", 3.99, 60), ("500g bag", 12.99, 40)]),

            ("Cherry Tomatoes",
             "Sweet vine-ripened cherry tomatoes. Great in salads, pasta, and on pizza.",
             4.49, None, 90, True, 4.6, "pack",
             {"organic": False, "source": "Queensland"},
             [("200g punnet", 4.49, 55), ("500g punnet", 9.99, 35)]),

            ("Dutch Carrots (Bunch)",
             "Colourful mixed Dutch baby carrots, tops on. Sweet and tender.",
             3.49, None, 75, False, 4.3, "bunch",
             {"organic": True, "source": "Western Australia"},
             [("Bunch ~300g", 3.49, 50), ("3-bunch pack", 9.49, 25)]),

            ("Broccoli Head",
             "Large fresh broccoli head with tight florets. Steam, roast or stir-fry.",
             2.99, None, 80, False, 4.4, "each",
             {"organic": False, "source": "Victoria"},
             [("Single head ~500g", 2.99, 50), ("2-pack", 5.49, 30)]),

            ("Avocado",
             "Ripe Hass avocados from Queensland. Perfect for smash, guacamole, or salads.",
             2.49, 2.99, 120, True, 4.7, "each",
             {"organic": False, "source": "Queensland"},
             [("Single", 2.49, 80), ("Bag of 4", 8.99, 40)]),

            ("Zucchini",
             "Fresh green zucchini. Versatile — grill, spiralise, roast, or stuff.",
             3.99, None, 65, False, 4.2, "kg",
             {"organic": False, "source": "New South Wales"},
             [("500g (~2-3 zucchinis)", 3.99, 40), ("1kg", 6.99, 25)]),

            ("Sweet Potato",
             "Orange-flesh sweet potato (kumara). Naturally sweet — roast, mash or bake.",
             4.49, None, 90, False, 4.5, "kg",
             {"organic": False, "source": "Queensland"},
             [("500g", 4.49, 55), ("1kg", 7.99, 35)]),

            ("Cucumber",
             "Cool, crisp continental cucumbers. Slice into salads or make tzatziki.",
             1.99, None, 100, False, 4.1, "each",
             {"organic": False, "source": "Victoria"},
             [("Single (~350g)", 1.99, 65), ("Bag of 3", 5.49, 35)]),

            ("Red Capsicum",
             "Sweet red capsicums, thick-walled and juicy. Roast whole or slice raw.",
             3.49, None, 70, False, 4.4, "each",
             {"organic": False, "source": "Queensland"},
             [("Single", 3.49, 45), ("3-pack", 8.99, 25)]),

            ("Cauliflower",
             "Large white cauliflower head. Steam, rice, roast whole, or use in curry.",
             3.49, None, 55, False, 4.3, "each",
             {"organic": False, "source": "Victoria"},
             [("Single head ~800g", 3.49, 35), ("2-pack", 6.49, 20)]),

            ("Kale (Curly)",
             "Organic curly kale, rich in vitamins K and C. Massage for salads or bake into chips.",
             3.99, None, 50, False, 4.4, "bunch",
             {"organic": True, "source": "New South Wales"},
             [("Bunch ~200g", 3.99, 30), ("Bag ~400g", 6.99, 20)]),

            ("Eggplant",
             "Deep purple eggplant with minimal seeds. Roast, grill or use in baba ganoush.",
             3.29, None, 45, False, 4.2, "each",
             {"organic": False, "source": "Queensland"},
             [("Single (~400g)", 3.29, 30), ("2-pack", 5.99, 15)]),

            ("Green Beans",
             "Fine young green beans, trimmed and ready. Blanch, stir-fry or roast with almonds.",
             4.99, None, 60, False, 4.5, "pack",
             {"organic": False, "source": "Victoria"},
             [("250g", 4.99, 40), ("500g", 8.99, 20)]),

            ("Portobello Mushrooms",
             "Meaty portobello mushroom caps. Stuff with cheese, or grill as a burger substitute.",
             4.99, 5.99, 45, True, 4.6, "pack",
             {"organic": False, "source": "New South Wales"},
             [("2-pack", 4.99, 30), ("4-pack", 8.99, 15)]),

            ("Iceberg Lettuce",
             "Crisp iceberg lettuce head. Classic for wedge salads and burger toppings.",
             2.49, None, 70, False, 4.0, "each",
             {"organic": False, "source": "Victoria"},
             [("Single head", 2.49, 50), ("2-pack", 4.49, 20)]),

            ("Snow Peas",
             "Tender, sweet snow peas. Stir-fry whole in Asian dishes or snack on them raw.",
             4.49, None, 50, False, 4.5, "pack",
             {"organic": True, "source": "Victoria"},
             [("150g", 4.49, 35), ("300g", 7.99, 15)]),

            ("Beetroot",
             "Raw whole beetroot, skin-on. Roast in foil, slice in salads, or juice.",
             3.49, None, 60, False, 4.3, "bunch",
             {"organic": True, "source": "South Australia"},
             [("Bunch of 3 ~600g", 3.49, 40), ("1kg bag", 5.99, 20)]),

            ("Corn on the Cob",
             "Sweet white corn cobs, husk-on. Grill or boil and slather with butter.",
             1.49, None, 90, False, 4.4, "each",
             {"organic": False, "source": "Queensland"},
             [("Single cob", 1.49, 60), ("4-pack", 4.99, 30)]),

            ("Pak Choy",
             "Baby pak choy (bok choy), crisp and tender. Steam or stir-fry with oyster sauce.",
             3.49, None, 65, False, 4.4, "pack",
             {"organic": False, "source": "New South Wales"},
             [("250g", 3.49, 45), ("500g", 5.99, 20)]),

            ("Asparagus",
             "Fresh green asparagus spears. Grill with olive oil and sea salt, or roast.",
             5.99, 6.99, 0, False, 4.6, "bunch",
             {"organic": False, "source": "Victoria"},
             [("Bunch ~200g", 5.99, 0)]),
        ],
    },

    "Rice & Grains": {
        "sort_order": 4,
        "description": "Premium rice, quinoa, oats, and specialty grains from around the world.",
        "products": [
            ("Jasmine Rice",
             "Fragrant Thai jasmine rice with a soft, slightly sticky texture when cooked.",
             7.99, None, 100, True, 4.7, "kg",
             {"grain_type": "Long-grain", "origin": "Thailand"},
             [("1kg", 7.99, 60), ("2kg", 14.99, 30), ("5kg", 32.99, 10)]),

            ("Basmati Rice",
             "Aged Indian basmati with extra-long grains. Fluffs up perfectly, no stickiness.",
             8.99, 10.99, 90, True, 4.8, "kg",
             {"grain_type": "Long-grain", "origin": "India"},
             [("1kg", 8.99, 55), ("2kg", 16.99, 25), ("5kg", 37.99, 10)]),

            ("Brown Rice",
             "Whole-grain brown rice. Nutty flavour and chewy texture. Higher in fibre.",
             6.99, None, 75, False, 4.4, "kg",
             {"grain_type": "Medium-grain", "origin": "Australia"},
             [("1kg", 6.99, 50), ("2kg", 12.99, 25)]),

            ("Sushi Rice",
             "Short-grain Japanese sushi rice. Sticky and glossy — perfect for rolls and bowls.",
             9.49, None, 60, False, 4.7, "kg",
             {"grain_type": "Short-grain", "origin": "Japan"},
             [("1kg", 9.49, 40), ("2kg", 17.99, 20)]),

            ("Quinoa (White)",
             "Organic white quinoa, complete protein. Cook in 15 minutes. Gluten-free.",
             9.99, 12.99, 80, True, 4.6, "kg",
             {"grain_type": "Pseudocereal", "origin": "Peru"},
             [("500g", 9.99, 50), ("1kg", 17.99, 30)]),

            ("Red Quinoa",
             "Nuttier, firmer red quinoa. Holds its shape well in salads and grain bowls.",
             10.99, None, 55, False, 4.5, "kg",
             {"grain_type": "Pseudocereal", "origin": "Bolivia"},
             [("500g", 10.99, 35), ("1kg", 19.99, 20)]),

            ("Rolled Oats",
             "Old-fashioned rolled oats. Creamy porridge, overnight oats, or granola.",
             4.99, None, 120, False, 4.5, "kg",
             {"grain_type": "Oat", "origin": "Australia"},
             [("1kg", 4.99, 75), ("2kg", 8.99, 35), ("5kg", 19.99, 10)]),

            ("Pearl Barley",
             "Hulled pearl barley. Add to soups, stews, and risotto for a hearty texture.",
             5.49, None, 65, False, 4.3, "kg",
             {"grain_type": "Barley", "origin": "Australia"},
             [("500g", 5.49, 40), ("1kg", 9.99, 25)]),

            ("Wild Rice Blend",
             "Mix of wild, red, and black rice. Dramatic presentation and nutty flavour.",
             8.49, 9.99, 50, False, 4.6, "kg",
             {"grain_type": "Mixed", "origin": "USA"},
             [("500g", 8.49, 35), ("1kg", 15.99, 15)]),

            ("Black Rice (Forbidden)",
             "Anthocyanin-rich black rice. Nutty, sweet and stunning in a rice bowl.",
             10.49, None, 40, True, 4.7, "kg",
             {"grain_type": "Short-grain", "origin": "China"},
             [("500g", 10.49, 25), ("1kg", 18.99, 15)]),

            ("Freekeh",
             "Roasted green wheat with a smoky, nutty flavour. Great with lamb or as a pilaf.",
             7.99, None, 35, False, 4.4, "kg",
             {"grain_type": "Wheat", "origin": "Lebanon"},
             [("500g", 7.99, 25), ("1kg", 13.99, 10)]),

            ("Millet",
             "Small, fast-cooking whole millet. Porridge, pilaf, or gluten-free flour.",
             5.99, None, 45, False, 4.2, "kg",
             {"grain_type": "Millet", "origin": "India"},
             [("500g", 5.99, 30), ("1kg", 10.99, 15)]),

            ("Red Lentils (Split)",
             "Split red lentils cook down into a creamy dhal in 20 minutes. High protein.",
             4.99, None, 90, False, 4.5, "kg",
             {"grain_type": "Legume", "origin": "Australia"},
             [("500g", 4.99, 55), ("1kg", 8.99, 35)]),

            ("Arborio Rice",
             "Italian short-grain rice for classic risotto. Creamy and al dente every time.",
             7.49, None, 55, False, 4.7, "kg",
             {"grain_type": "Short-grain", "origin": "Italy"},
             [("500g", 7.49, 35), ("1kg", 13.99, 20)]),

            ("Buckwheat Groats",
             "Toasted buckwheat groats (kasha). Nutty, earthy and naturally gluten-free.",
             8.49, None, 30, False, 4.3, "kg",
             {"grain_type": "Pseudocereal", "origin": "Russia"},
             [("500g", 8.49, 20), ("1kg", 14.99, 10)]),

            ("Steel-Cut Oats",
             "Minimally processed steel-cut oats. Chewier porridge with a lower GI.",
             7.99, None, 50, False, 4.6, "kg",
             {"grain_type": "Oat", "origin": "Australia"},
             [("500g", 7.99, 30), ("1kg", 13.99, 20)]),

            ("Tri-Colour Quinoa",
             "Blend of white, red, and black quinoa for colour and varied texture.",
             11.49, 13.99, 40, False, 4.5, "kg",
             {"grain_type": "Pseudocereal", "origin": "Peru"},
             [("500g", 11.49, 25), ("1kg", 20.99, 15)]),

            ("Jasmine Brown Rice",
             "Thai brown jasmine rice — the fibre-rich version of the aromatic classic.",
             8.49, None, 60, False, 4.4, "kg",
             {"grain_type": "Long-grain", "origin": "Thailand"},
             [("1kg", 8.49, 40), ("2kg", 15.99, 20)]),

            ("Green Split Peas",
             "Dried green split peas for hearty pea-and-ham soup or smoky dhal.",
             3.99, None, 70, False, 4.2, "kg",
             {"grain_type": "Legume", "origin": "Canada"},
             [("500g", 3.99, 45), ("1kg", 6.99, 25)]),

            ("Farro",
             "Ancient Italian wheat grain with a chewy bite. Perfect in soups and grain bowls.",
             8.99, None, 0, False, 4.4, "kg",
             {"grain_type": "Wheat", "origin": "Italy"},
             [("500g", 8.99, 0), ("1kg", 15.99, 0)]),
        ],
    },

    "Oil & Condiments": {
        "sort_order": 5,
        "description": "Premium cooking oils, vinegars, sauces, and pantry essentials.",
        "products": [
            ("Extra Virgin Olive Oil",
             "Cold-pressed Australian extra virgin olive oil. Peppery finish, low acidity.",
             15.99, 18.99, 80, True, 4.8, "bottle",
             {"brand": "Grove Estate", "volume": "500ml"},
             [("250ml", 8.99, 50), ("500ml", 15.99, 25), ("1L", 27.99, 5)]),

            ("Coconut Oil (Organic)",
             "Unrefined virgin coconut oil, cold-pressed. Mild coconut aroma.",
             12.99, None, 65, False, 4.6, "jar",
             {"brand": "Loving Earth", "volume": "500ml"},
             [("300ml", 8.99, 40), ("500ml", 12.99, 25)]),

            ("Sesame Oil (Toasted)",
             "Dark toasted sesame oil for Asian stir-fries, dressings, and marinades.",
             8.49, None, 70, False, 4.7, "bottle",
             {"brand": "Lee Kum Kee", "volume": "250ml"},
             [("125ml", 4.99, 45), ("250ml", 8.49, 25)]),

            ("Avocado Oil",
             "Light, neutral avocado oil with a high smoke point. Great for high-heat cooking.",
             14.99, 17.49, 55, False, 4.6, "bottle",
             {"brand": "Olivado", "volume": "500ml"},
             [("250ml", 7.99, 35), ("500ml", 14.99, 20)]),

            ("Sunflower Oil",
             "Refined sunflower oil for everyday frying and baking. Light and neutral.",
             5.99, None, 100, False, 4.2, "bottle",
             {"brand": "Peerless", "volume": "2L"},
             [("750ml", 3.99, 65), ("2L", 5.99, 35)]),

            ("Apple Cider Vinegar (Raw)",
             "Unpasteurised ACV with the mother. Use in dressings, marinades or wellness shots.",
             9.99, None, 60, True, 4.7, "bottle",
             {"brand": "Bragg", "volume": "473ml"},
             [("473ml", 9.99, 40), ("946ml", 17.99, 20)]),

            ("Soy Sauce (Tamari)",
             "Wheat-free tamari soy sauce. Richer and less salty than regular soy.",
             6.99, None, 75, False, 4.6, "bottle",
             {"brand": "Kikkoman", "volume": "250ml"},
             [("150ml", 4.49, 50), ("250ml", 6.99, 25)]),

            ("Fish Sauce",
             "Traditional Thai fish sauce made from fermented anchovies. Bold umami flavour.",
             4.99, None, 80, False, 4.5, "bottle",
             {"brand": "Tiparos", "volume": "300ml"},
             [("150ml", 2.99, 50), ("300ml", 4.99, 30)]),

            ("Oyster Sauce",
             "Classic oyster sauce for stir-fries, braises, and glazes.",
             5.49, None, 90, False, 4.6, "bottle",
             {"brand": "Lee Kum Kee", "volume": "510g"},
             [("255g", 3.49, 55), ("510g", 5.49, 35)]),

            ("Sriracha Hot Sauce",
             "The iconic Thai chilli garlic sauce. Add heat to everything.",
             6.49, None, 85, True, 4.7, "bottle",
             {"brand": "Huy Fong", "volume": "435ml"},
             [("230ml", 3.99, 55), ("435ml", 6.49, 30)]),

            ("Hoisin Sauce",
             "Sweet, thick Chinese hoisin. Use in Peking duck, marinades, and noodle dishes.",
             5.99, None, 70, False, 4.5, "bottle",
             {"brand": "Lee Kum Kee", "volume": "400g"},
             [("225g", 3.49, 45), ("400g", 5.99, 25)]),

            ("Mirin (Cooking Sake)",
             "Japanese sweet rice wine for teriyaki glazes, ramen, and soups.",
             7.99, None, 55, False, 4.6, "bottle",
             {"brand": "Kikkoman", "volume": "500ml"},
             [("250ml", 4.99, 35), ("500ml", 7.99, 20)]),

            ("Balsamic Vinegar of Modena",
             "Aged Italian balsamic, thick and sweet. Drizzle over salads and strawberries.",
             12.99, 15.99, 45, False, 4.8, "bottle",
             {"brand": "Acetaia Malpighi", "volume": "250ml"},
             [("100ml", 8.99, 30), ("250ml", 12.99, 15)]),

            ("Dijon Mustard",
             "Classic French Dijon mustard. Sharp and tangy in dressings and sauces.",
             5.49, None, 70, False, 4.5, "jar",
             {"brand": "Maille", "volume": "215g"},
             [("215g", 5.49, 45), ("430g", 9.49, 25)]),

            ("Tahini (Hulled)",
             "Smooth, creamy tahini from hulled sesame seeds. Base for hummus and dressings.",
             9.99, None, 60, False, 4.7, "jar",
             {"brand": "Mayver's", "volume": "385g"},
             [("250g", 6.99, 40), ("385g", 9.99, 20)]),

            ("Honey (Raw Manuka)",
             "New Zealand UMF 10+ manuka honey. Prized for wellness and rich, earthy flavour.",
             34.99, 39.99, 25, True, 4.9, "jar",
             {"brand": "Comvita", "volume": "250g"},
             [("250g", 34.99, 15), ("500g", 64.99, 10)]),

            ("Tomato Passata",
             "Strained Italian tomatoes, no additives. Foundation for pasta sauces and pizzas.",
             4.49, None, 90, False, 4.4, "bottle",
             {"brand": "Mutti", "volume": "700ml"},
             [("400g", 2.99, 60), ("700ml", 4.49, 30)]),

            ("Coconut Aminos",
             "Soy-free, gluten-free soy sauce alternative. Slightly sweet and salty.",
             10.99, None, 40, False, 4.5, "bottle",
             {"brand": "Coconut Secret", "volume": "237ml"},
             [("237ml", 10.99, 25), ("474ml", 19.99, 15)]),

            ("White Wine Vinegar",
             "Mild, crisp white wine vinegar for dressings, pickling, and hollandaise.",
             4.99, None, 65, False, 4.3, "bottle",
             {"brand": "Maille", "volume": "500ml"},
             [("250ml", 3.49, 40), ("500ml", 4.99, 25)]),

            ("Peanut Oil",
             "Refined peanut oil with a high smoke point. Ideal for deep-frying and wok cooking.",
             8.99, None, 0, False, 4.4, "bottle",
             {"brand": "Luhua", "volume": "900ml"},
             [("500ml", 5.99, 0), ("900ml", 8.99, 0)]),
        ],
    },
}


# ─── Command ──────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = "Seed the database with ~100 realistic grocery products across 5 categories."

    def add_arguments(self, parser):
        parser.add_argument(
            "--flush",
            action="store_true",
            help=(
                "Delete orders, cart lines, wishlist/reviews tied to products, then all products "
                "and seed categories before re-seeding. Destructive — for dev/testing only."
            ),
        )

    def handle(self, *args, **options):
        if options["flush"]:
            self.stdout.write(
                self.style.WARNING(
                    "Flushing: orders → cart items → wishlist → reviews → variants → images → products → categories..."
                )
            )
            with transaction.atomic():
                # OrderItem.product uses PROTECT — must remove order lines (via Order CASCADE) first
                order_delete = Order.objects.all().delete()
                CartItem.objects.all().delete()
                WishlistItem.objects.all().delete()
                Review.objects.all().delete()
                ProductVariant.objects.all().delete()
                ProductImage.objects.all().delete()
                Product.objects.all().delete()
                Category.objects.filter(name__in=SEED_DATA.keys()).delete()
            n_deleted = order_delete[0]
            self.stdout.write(self.style.SUCCESS(f"Done ({n_deleted} DB rows removed from orders and cascaded tables).\n"))

        total_products = 0
        total_variants = 0

        for cat_name, cat_data in SEED_DATA.items():
            # ── Category ──────────────────────────────────────────────────────
            category, created = Category.objects.get_or_create(
                name=cat_name,
                defaults={
                    "description": cat_data["description"],
                    "sort_order": cat_data["sort_order"],
                    "is_active": True,
                },
            )
            action = "Created" if created else "Found"
            self.stdout.write(f"  {action} category: {cat_name}")

            # Placeholder image for this category
            bg, fg = CATEGORY_COLORS.get(cat_name, ("#F3F4F6", "#374151"))
            placeholder = make_placeholder(cat_name, bg, fg)

            for p_data in cat_data["products"]:
                (name, description, base_price, compare_price,
                 stock, is_featured, rating, unit, attributes, variants) = p_data

                # ── Product ───────────────────────────────────────────────────
                if Product.objects.filter(name=name).exists():
                    self.stdout.write(f"    Skipping (exists): {name}")
                    continue

                sku = f"MK-{str(uuid.uuid4()).upper()[:8]}"
                slug_base = slugify(name)
                slug = slug_base
                counter = 1
                while Product.objects.filter(slug=slug).exists():
                    slug = f"{slug_base}-{counter}"
                    counter += 1

                product = Product.objects.create(
                    name=name,
                    slug=slug,
                    description=description,
                    category=category,
                    base_price=base_price,
                    compare_price=resolve_product_compare(base_price, compare_price),
                    stock_quantity=stock,
                    is_active=True,
                    is_featured=is_featured,
                    average_rating=rating,
                    review_count=random.randint(5, 120),
                    unit=unit,
                    attributes=attributes,
                    sku=sku,
                    tags=[cat_name.lower(), unit],
                )

                # ── Primary image ─────────────────────────────────────────────
                img_file = make_placeholder(name, bg, fg)
                product_image = ProductImage(
                    product=product,
                    alt_text=name,
                    is_primary=True,
                    sort_order=0,
                )
                product_image.image.save(img_file.name, img_file, save=True)

                # ── Variants ──────────────────────────────────────────────────
                variant_objs = []
                for i, (v_name, v_price, v_stock) in enumerate(variants):
                    v_sku = f"MKV-{str(uuid.uuid4()).upper()[:8]}"
                    variant_objs.append(ProductVariant(
                        product=product,
                        name=v_name,
                        sku=v_sku,
                        price=v_price,
                        compare_price=maybe_variant_compare(v_price),
                        stock_quantity=v_stock,
                        is_active=True,
                        sort_order=i,
                    ))

                ProductVariant.objects.bulk_create(variant_objs)
                total_variants += len(variant_objs)
                total_products += 1

                stock_label = "OUT" if stock == 0 else f"{'LOW' if stock <= 10 else 'OK':>3} ({stock})"
                self.stdout.write(
                    f"    + {name:<45} stock={stock_label}  variants={len(variant_objs)}"
                )

        backfill_missing_discounts(self.stdout, self.style)

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            f"Seeding complete. {total_products} products, {total_variants} variants created."
        ))
