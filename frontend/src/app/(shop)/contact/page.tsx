"use client";
import { useState } from "react";
import { MapPin, Phone, Mail, Clock, Send, Loader2, CheckCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useStoreProfile } from "@/hooks/useStoreProfile";

type ContactCard = { icon: React.ElementType; label: string; value: string; href?: string };
type HoursRow = { day: string; time: string; closed: boolean };

const FALLBACK_CARDS: ContactCard[] = [
  { icon: MapPin, label: "Our Store", value: "8/63 Winnellie Rd\nWinnellie NT 0820\nAustralia" },
  { icon: Phone, label: "Phone", value: "0449 529 923", href: "tel:0449529923" },
  { icon: Mail, label: "Email", value: "hello@marykitchen.com.au", href: "mailto:hello@marykitchen.com.au" },
];

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { data: store } = useStoreProfile();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    setSent(true);
    toast.success("Message sent! We'll get back to you soon.");
  };

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const addressValue = store
    ? [
        store.address,
        [store.suburb, store.state, store.postcode].filter(Boolean).join(" "),
        "Australia",
      ].filter(Boolean).join("\n")
    : "";

  const is247 = store?.opening_hours
    ? store.opening_hours.split("\n").every((l) => l.includes("12:00 AM – 11:59 PM"))
    : false;

  const hoursRows: HoursRow[] = store?.opening_hours && !is247
    ? store.opening_hours.split("\n").map((line) => {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) return { day: line, time: "", closed: false };
        const day = line.slice(0, colonIdx).trim();
        const time = line.slice(colonIdx + 1).trim();
        return { day, time, closed: time === "Closed" };
      })
    : [
        { day: "Monday – Friday", time: "9:00 AM – 5:00 PM", closed: false },
        { day: "Saturday", time: "10:00 AM – 3:00 PM", closed: false },
        { day: "Sunday", time: "", closed: true },
      ];

  const cards: ContactCard[] = store
    ? [
        store.address && { icon: MapPin, label: "Our Store", value: addressValue },
        store.phone && { icon: Phone, label: "Phone", value: store.phone, href: `tel:${store.phone.replace(/[\s\-().]/g, "")}` },
        store.email && { icon: Mail, label: "Email", value: store.email, href: `mailto:${store.email}` },
      ].filter((c): c is ContactCard => Boolean(c))
    : FALLBACK_CARDS;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-primary-700 text-white py-16">
        <div className="container-xl text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-2xl mb-4">
            <Mail className="w-8 h-8" />
          </div>
          <h1 className="text-4xl font-bold mb-3">Contact Us</h1>
          <p className="text-primary-100 text-lg">We'd love to hear from you. Get in touch any time.</p>
        </div>
      </div>

      <div className="container-xl py-14">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 max-w-5xl mx-auto">

          {/* Contact Details */}
          <div className="lg:col-span-2 space-y-5">
            <h2 className="text-xl font-bold text-gray-900">Get in Touch</h2>

            {cards.map(({ icon: Icon, label, value, href }) => (
              <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
                <div className="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Icon className="w-5 h-5 text-primary-700" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
                  {href ? (
                    <a href={href} className="text-sm text-primary-700 hover:underline font-medium whitespace-pre-line">{value}</a>
                  ) : (
                    <p className="text-sm text-gray-700 whitespace-pre-line">{value}</p>
                  )}
                </div>
              </div>
            ))}

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-start gap-4">
              <div className="w-10 h-10 bg-primary-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-primary-700" />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Opening Hours</p>
                {is247 ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 border border-green-200 text-sm font-semibold px-3 py-1 rounded-full">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      Open 24/7
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-sm">
                    {hoursRows.map(({ day, time, closed }) => (
                      <div key={day} className="flex justify-between gap-4">
                        <span className="text-gray-500">{day}</span>
                        {closed ? (
                          <span className="text-red-400 font-medium">Closed</span>
                        ) : (
                          <span className="font-medium text-gray-700">{time}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              {sent ? (
                <div className="text-center py-10">
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Message Sent!</h3>
                  <p className="text-gray-500">Thank you for reaching out. We'll get back to you within 24 hours.</p>
                  <button
                    onClick={() => { setSent(false); setForm({ name: "", email: "", subject: "", message: "" }); }}
                    className="btn-primary mt-6"
                  >
                    Send Another Message
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-gray-900 mb-6">Send Us a Message</h2>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Your Name <span className="text-red-500">*</span></label>
                        <input required value={form.name} onChange={update("name")} className="input-field" placeholder="Jane Smith" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
                        <input required type="email" value={form.email} onChange={update("email")} className="input-field" placeholder="jane@example.com" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Subject <span className="text-red-500">*</span></label>
                      <select required value={form.subject} onChange={update("subject")} className="input-field">
                        <option value="">Select a topic</option>
                        <option value="order">Order Issue</option>
                        <option value="delivery">Delivery Enquiry</option>
                        <option value="product">Product Question</option>
                        <option value="refund">Refund Request</option>
                        <option value="feedback">General Feedback</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Message <span className="text-red-500">*</span></label>
                      <textarea required value={form.message} onChange={update("message")} rows={5} className="input-field resize-none" placeholder="Tell us how we can help..." />
                    </div>
                    <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      {loading ? "Sending..." : "Send Message"}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
