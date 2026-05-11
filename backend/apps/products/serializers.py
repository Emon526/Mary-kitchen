"""Product app serializers."""
from django.utils.text import slugify

from rest_framework import serializers

from core.validators import validate_image_file
from .models import AttributeDefinition, Category, Product, ProductImage, ProductVariant


def _unique_category_slug(name: str, *, exclude_pk=None) -> str:
    base = slugify(name.strip()) or "category"
    slug = base
    n = 1
    qs = Category.objects.all()
    if exclude_pk is not None:
        qs = qs.exclude(pk=exclude_pk)
    while qs.filter(slug=slug).exists():
        slug = f"{base}-{n}"
        n += 1
    return slug


def _discount_pct(compare, price) -> int:
    """(compare - price) / compare * 100, rounded; 0 if no valid discount. Matches Product.discount_percentage."""
    if compare is None or price is None:
        return 0
    if compare <= price:
        return 0
    return int(round(float((compare - price) / compare * 100)))


def _best_variant_deal(obj: Product):
    """
    Among active variants with compare_price > price, return (pct, sale_price, compare_price)
    for the variant with the highest discount percentage; else None.
    """
    best = None
    variants = getattr(obj, "_prefetched_objects_cache", {}).get("variants")
    if variants is not None:
        iterable = [v for v in variants if v.is_active]
    else:
        iterable = list(obj.variants.filter(is_active=True))
    for v in iterable:
        if v.compare_price is None or v.price is None:
            continue
        if v.compare_price <= v.price:
            continue
        pct = _discount_pct(v.compare_price, v.price)
        if best is None or pct > best[0]:
            best = (pct, v.price, v.compare_price)
    return best


class CategorySerializer(serializers.ModelSerializer):
    """Public + admin: category with absolute ``image_url`` for clients."""
    subcategories = serializers.SerializerMethodField()
    product_count = serializers.SerializerMethodField()
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = [
            "id", "name", "slug", "description", "image", "image_url", "parent",
            "is_active", "sort_order", "subcategories", "product_count",
        ]
        read_only_fields = ["id", "slug", "image_url", "subcategories", "product_count"]

    def get_image_url(self, obj):
        if not obj.image:
            return None
        request = self.context.get("request")
        url = obj.image.url
        if request:
            return request.build_absolute_uri(url)
        return url

    def validate_image(self, value):
        return validate_image_file(value)

    def validate_name(self, value):
        name = (value or "").strip()
        if not name:
            raise serializers.ValidationError("Name is required.")
        qs = Category.objects.filter(name__iexact=name)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A category with this name already exists.")
        return name

    def create(self, validated_data):
        validated_data["name"] = validated_data["name"].strip()
        validated_data["slug"] = _unique_category_slug(validated_data["name"])
        return super().create(validated_data)

    def update(self, instance, validated_data):
        if "name" in validated_data:
            new_name = validated_data["name"].strip()
            validated_data["name"] = new_name
            if new_name != instance.name:
                validated_data["slug"] = _unique_category_slug(new_name, exclude_pk=instance.pk)
        return super().update(instance, validated_data)

    def get_subcategories(self, obj):
        children = obj.subcategories.filter(is_active=True)
        return CategorySerializer(children, many=True, context=self.context).data

    def get_product_count(self, obj):
        return obj.products.filter(is_active=True).count()


class AttributeDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttributeDefinition
        fields = ["id", "name", "key", "field_type", "options", "is_required", "sort_order"]


class ProductImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ["id", "image", "alt_text", "is_primary", "sort_order"]


class ProductVariantSerializer(serializers.ModelSerializer):
    discount_percentage = serializers.SerializerMethodField()

    class Meta:
        model = ProductVariant
        fields = [
            "id", "name", "sku", "price", "compare_price",
            "stock_quantity", "is_active", "sort_order", "attributes",
            "discount_percentage", "is_in_stock",
        ]

    def get_discount_percentage(self, obj):
        if obj.compare_price and obj.compare_price > obj.price:
            return _discount_pct(obj.compare_price, obj.price)
        return 0


class ProductListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    primary_image = serializers.SerializerMethodField()
    category_name = serializers.ReadOnlyField(source="category.name")
    has_variants = serializers.SerializerMethodField()
    discount_percentage = serializers.SerializerMethodField()
    sale_price = serializers.SerializerMethodField()
    compare_at_price = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "category", "category_name",
            "base_price", "compare_price", "discount_percentage",
            "sale_price", "compare_at_price",
            "stock_quantity", "is_in_stock", "is_featured",
            "average_rating", "review_count", "unit",
            "primary_image", "has_variants", "tags",
        ]

    def get_discount_percentage(self, obj):
        if obj.compare_price is not None and obj.compare_price > obj.base_price:
            return _discount_pct(obj.compare_price, obj.base_price)
        best = _best_variant_deal(obj)
        return best[0] if best else 0

    def get_sale_price(self, obj):
        if obj.compare_price is not None and obj.compare_price > obj.base_price:
            return obj.base_price
        best = _best_variant_deal(obj)
        return best[1] if best else obj.base_price

    def get_compare_at_price(self, obj):
        if obj.compare_price is not None and obj.compare_price > obj.base_price:
            return obj.compare_price
        best = _best_variant_deal(obj)
        return best[2] if best else None

    def get_primary_image(self, obj):
        img = obj.images.filter(is_primary=True).first() or obj.images.first()
        if img:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(img.image.url)
        return None

    def get_has_variants(self, obj):
        return obj.variants.filter(is_active=True).exists()


class ProductDetailSerializer(serializers.ModelSerializer):
    """Full serializer for product detail view."""
    images = ProductImageSerializer(many=True, read_only=True)
    variants = ProductVariantSerializer(many=True, read_only=True)
    category = CategorySerializer(read_only=True)
    attribute_definitions = serializers.SerializerMethodField()
    discount_percentage = serializers.SerializerMethodField()
    sale_price = serializers.SerializerMethodField()
    compare_at_price = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "slug", "description", "category",
            "base_price", "compare_price", "discount_percentage",
            "sale_price", "compare_at_price",
            "stock_quantity", "allow_out_of_stock_orders", "is_in_stock",
            "is_active", "is_featured", "average_rating", "review_count",
            "weight", "unit", "attributes", "sku", "tags",
            "images", "variants", "attribute_definitions",
            "created_at", "updated_at",
        ]

    def get_discount_percentage(self, obj):
        if obj.compare_price is not None and obj.compare_price > obj.base_price:
            return _discount_pct(obj.compare_price, obj.base_price)
        best = _best_variant_deal(obj)
        return best[0] if best else 0

    def get_sale_price(self, obj):
        if obj.compare_price is not None and obj.compare_price > obj.base_price:
            return obj.base_price
        best = _best_variant_deal(obj)
        return best[1] if best else obj.base_price

    def get_compare_at_price(self, obj):
        if obj.compare_price is not None and obj.compare_price > obj.base_price:
            return obj.compare_price
        best = _best_variant_deal(obj)
        return best[2] if best else None

    def get_attribute_definitions(self, obj):
        defs = AttributeDefinition.objects.filter(category=obj.category)
        return AttributeDefinitionSerializer(defs, many=True).data


class ProductCreateUpdateSerializer(serializers.ModelSerializer):
    """For admin product create/update."""
    class Meta:
        model = Product
        fields = [
            "id", "name", "description", "category",
            "base_price", "compare_price",
            "stock_quantity", "allow_out_of_stock_orders",
            "is_active", "is_featured",
            "weight", "unit", "attributes", "sku", "tags",
        ]
        read_only_fields = ["id"]

    def validate_sku(self, value):
        qs = Product.objects.filter(sku=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("SKU must be unique.")
        return value


class AdminProductSerializer(ProductDetailSerializer):
    """Admin list/detail for admin product CRUD (same fields as public detail + admin flags)."""
    pass
