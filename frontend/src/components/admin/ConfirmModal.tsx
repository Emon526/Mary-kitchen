"use client";

import { AlertTriangle, Info, X } from "lucide-react";

export type ConfirmModalVariant = "danger" | "primary" | "warning";

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  /** Default: primary */
  variant?: ConfirmModalVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

const variantIcon = {
  danger: { wrap: "bg-red-100", icon: "text-red-600", Icon: AlertTriangle },
  warning: { wrap: "bg-amber-100", icon: "text-amber-600", Icon: AlertTriangle },
  primary: { wrap: "bg-primary-100", icon: "text-primary-700", Icon: Info },
} as const;

const variantConfirmClass: Record<ConfirmModalVariant, string> = {
  danger: "bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold",
  warning: "bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold",
  primary: "btn-primary",
};

export default function ConfirmModal({
  open,
  title,
  description,
  confirmText,
  cancelText,
  variant = "primary",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;
  const { wrap, icon, Icon } = variantIcon[variant];
  const confirmClass = variantConfirmClass[variant];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in zoom-in-95 duration-200"
      >
        <button
          type="button"
          onClick={onCancel}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 text-gray-400"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${wrap}`}>
            <Icon className={`w-5 h-5 ${icon}`} aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 id="confirm-modal-title" className="font-bold text-gray-900 text-base mb-1">
              {title}
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-line">{description}</p>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onCancel} className="btn-secondary flex-1 text-sm py-2">
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm} className={`${confirmClass} flex-1 text-sm py-2`}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
