"""Product system: Category, Product, Variant, Attributes, Images."""
from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models, transaction
from django.utils.text import slugify

from core.mixins import BaseModel


class Category(BaseModel):
    """Product category supporting nested subcategories."""
    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True, max_length=220)
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to="categories/", blank=True, null=True)
    parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="subcategories"
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "categories"
        verbose_name_plural = "Categories"
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)

        being_disabled = False
        update_fields = kwargs.get("update_fields")
        if self.pk and (update_fields is None or "is_active" in update_fields):
            prev = Category.objects.filter(pk=self.pk).values_list("is_active", flat=True).first()
            if prev is True and not self.is_active:
                being_disabled = True

        with transaction.atomic():
            super().save(*args, **kwargs)
            if being_disabled:
                self._cascade_disable()

    def _cascade_disable(self):
        """Bulk-disable all products and subcategories when this category is disabled."""
        descendant_ids = []
        queue = list(Category.objects.filter(parent=self).values_list("pk", flat=True))
        while queue:
            descendant_ids.extend(queue)
            queue = list(Category.objects.filter(parent_id__in=queue).values_list("pk", flat=True))

        if descendant_ids:
            Category.objects.filter(pk__in=descendant_ids).update(is_active=False)

        all_ids = [self.pk] + descendant_ids
        Product.objects.filter(category_id__in=all_ids, is_active=True).update(is_active=False)

    @property
    def is_root(self):
        return self.parent is None


class AttributeDefinition(BaseModel):
    """Admin-defined dynamic attributes per category (e.g. Fish → freshness, cut type)."""
    FIELD_TYPES = [
        ("text", "Text"),
        ("number", "Number"),
        ("select", "Select (dropdown)"),
        ("multi_select", "Multi-Select"),
        ("boolean", "Boolean"),
    ]

    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="attribute_definitions")
    name = models.CharField(max_length=100)
    key = models.SlugField(max_length=100)
    field_type = models.CharField(max_length=20, choices=FIELD_TYPES, default="text")
    options = models.JSONField(default=list, blank=True, help_text="For select/multi-select fields")
    is_required = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "attribute_definitions"
        unique_together = [("category", "key")]
        ordering = ["sort_order", "name"]

    def __str__(self):
        return f"{self.category.name} → {self.name}"


class Product(BaseModel):
    """Core product model."""
    name = models.CharField(max_length=500, db_index=True)
    slug = models.SlugField(unique=True, max_length=550)
    description = models.TextField(blank=True)
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="products")

    base_price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0)])
    compare_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Original price before discount"
    )

    stock_quantity = models.PositiveIntegerField(default=0)
    allow_out_of_stock_orders = models.BooleanField(default=True)

    is_active = models.BooleanField(default=True, db_index=True)
    is_featured = models.BooleanField(default=False)

    average_rating = models.DecimalField(
        max_digits=3, decimal_places=2, default=0,
        validators=[MinValueValidator(0), MaxValueValidator(5)]
    )
    review_count = models.PositiveIntegerField(default=0)

    weight = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True, help_text="Weight in grams")
    unit = models.CharField(max_length=20, default="each", help_text="e.g. each, kg, litre")

    attributes = models.JSONField(
        default=dict, blank=True,
        help_text="Dynamic attributes matching category AttributeDefinitions"
    )

    sku = models.CharField(max_length=100, unique=True, blank=True)
    tags = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "products"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["category", "is_active"]),
            models.Index(fields=["is_featured", "is_active"]),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if not self.slug:
            base_slug = slugify(self.name)
            slug = base_slug
            counter = 1
            while Product.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base_slug}-{counter}"
                counter += 1
            self.slug = slug
        if not self.sku:
            import uuid
            self.sku = f"MK-{str(uuid.uuid4()).upper()[:8]}"
        super().save(*args, **kwargs)

    @property
    def is_in_stock(self):
        return self.stock_quantity > 0

    @property
    def discount_percentage(self):
        if self.compare_price and self.compare_price > self.base_price:
            return round(((self.compare_price - self.base_price) / self.compare_price) * 100)
        return 0

    def update_rating(self):
        from apps.reviews.models import Review
        reviews = Review.objects.filter(product=self, is_approved=True)
        count = reviews.count()
        avg = reviews.aggregate(avg=models.Avg("rating"))["avg"] or 0
        self.review_count = count
        self.average_rating = round(avg, 2)
        self.save(update_fields=["review_count", "average_rating"])


class ProductImage(BaseModel):
    """Multiple images per product."""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="products/")
    alt_text = models.CharField(max_length=200, blank=True)
    is_primary = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "product_images"
        ordering = ["-is_primary", "sort_order"]

    def save(self, *args, **kwargs):
        if self.is_primary:
            ProductImage.objects.filter(product=self.product, is_primary=True).exclude(pk=self.pk).update(
                is_primary=False
            )
        super().save(*args, **kwargs)


class ProductVariant(BaseModel):
    """Admin-defined product variants (e.g. 500g, 1kg, 2kg)."""
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    name = models.CharField(max_length=200, help_text="e.g. 500g, 1kg, Red, Large")
    sku = models.CharField(max_length=100, unique=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, validators=[MinValueValidator(0)])
    compare_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    stock_quantity = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)
    attributes = models.JSONField(default=dict, blank=True, help_text="Variant-specific attributes")

    class Meta:
        db_table = "product_variants"
        ordering = ["sort_order", "name"]

    def __str__(self):
        return f"{self.product.name} – {self.name}"

    def save(self, *args, **kwargs):
        if not self.sku:
            import uuid
            self.sku = f"MKV-{str(uuid.uuid4()).upper()[:8]}"
        super().save(*args, **kwargs)

    @property
    def is_in_stock(self):
        return self.stock_quantity > 0
