const notifications = [
  { id: 1, text: "Order placed successfully", time: "2 min ago" },
  { id: 2, text: "Product back in stock", time: "1 hour ago" },
  { id: 3, text: "Your delivery fee has been updated", time: "Today" },
  { id: 4, text: "New deals are available", time: "Yesterday" },
];

export default function NotificationsPage() {
  return (
    <div className="container-xl py-8">
      <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-100">
        <h1 className="text-2xl font-bold mb-4 text-gray-900">Notifications</h1>

        <div className="space-y-2">
          {notifications.map((n) => (
            <div key={n.id} className="p-4 border border-gray-200 rounded-lg">
              <p className="text-gray-900">{n.text}</p>
              <span className="text-sm text-gray-500">{n.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
