import Link from "next/link";
import Image from "next/image";
import { Tag } from "lucide-react";
import { absoluteMediaUrl } from "@/lib/media";

interface CategoryCardProps {
  category: {
    id: string;
    name: string;
    slug: string;
    image?: string | null;
    image_url?: string | null;
    product_count: number;
  };
}

export default function CategoryCard({ category }: CategoryCardProps) {
  const src = absoluteMediaUrl(category.image_url ?? category.image ?? null);

  return (
    <Link href={`/products?category=${category.slug}`}
      className="flex flex-col items-center gap-2 group cursor-pointer">
      <div className="w-full aspect-square rounded-xl overflow-hidden bg-gradient-to-br from-primary-100 to-primary-50 border border-primary-100 group-hover:shadow-md transition-shadow">
        {src ? (
          <div className="relative w-full h-full">
            <Image src={src} alt={category.name} fill className="object-cover group-hover:scale-105 transition-transform duration-300" sizes="(max-width: 768px) 33vw, 12vw" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-primary-400" aria-hidden>
            <Tag className="w-10 h-10 sm:w-12 sm:h-12" strokeWidth={1.25} />
          </div>
        )}
      </div>
      <p className="text-xs font-semibold text-gray-700 text-center group-hover:text-primary-700 line-clamp-2">{category.name}</p>
    </Link>
  );
}
