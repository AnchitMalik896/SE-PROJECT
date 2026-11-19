// Shapes returned by the API (see backend/src/routes/*). Money is always an integer number of paise.

export type Role = 'CONSUMER' | 'FARMER' | 'DELIVERY' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'PENDING' | 'REJECTED' | 'BLOCKED';
export type OrderStatus = 'PLACED' | 'ACCEPTED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type DeliveryStatus = 'UNASSIGNED' | 'ASSIGNED' | 'PICKED_UP' | 'ON_THE_WAY' | 'DELIVERED' | 'FAILED';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FarmerProfile {
  id: string;
  userId: string;
  farmName: string;
  farmLocation: string;
  bio: string | null;
  verification: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: UserStatus;
  address: string | null;
  farmerProfile?: FarmerProfile | null;
}

export interface AdminUser extends User {
  blockReason: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
}

/** Public product (marketplace) */
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  inStock: boolean;
  photoUrl: string | null;
  category: Category | null;
  farmer: { id: string; name: string; farmName: string; farmLocation: string; rating: number | null; ratingCount: number };
}

/** Farmer's own product row (GET /farmer/products) */
export interface FarmerProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  photoUrl: string | null;
  categoryId: string | null;
  category: Category | null;
  takenDownReason: string | null;
  createdAt: string;
}

export interface CartItem {
  productId: string;
  name: string;
  unit: string;
  price: number;
  photoUrl: string | null;
  quantity: number;
  stock: number;
  farmerId: string;
  farmName: string;
  available: boolean;
  problem: string | null;
  lineTotal: number;
}
export interface Cart {
  items: CartItem[];
  total: number;
  count: number;
  hasProblems: boolean;
}

export interface OrderItem {
  productId: string;
  name: string;
  unit: string;
  unitPrice: number;
  quantity: number;
}

export interface OrderDelivery {
  id: string;
  status: DeliveryStatus;
  assignedTo: { name: string; phone: string } | null;
  readyAt: string;
  updatedAt: string;
  completedAt: string | null;
  failureReason?: string | null;
  location: { lat: number; lng: number; updatedAt: string | null } | null;
}

export interface Order {
  id: string;
  ref: string;
  groupId: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  payoutStatus?: 'HELD' | 'RELEASED' | 'REFUNDED';
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** null for farmers: they never see the customer's address (the delivery partner does) */
  deliveryAddress: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  farmer: { id: string; name: string; farmName: string; farmLocation: string };
  consumer?: { id: string; name: string };
  deliveryOtp?: string | null;
  refunded: number;
  ratedProductIds: string[];
  delivery: OrderDelivery | null;
  flags?: string[]; // admin lists only
}

export interface Payment {
  groupId: string;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  failureReason: string | null;
  attempts: number;
  gatewayRef?: string;
  mockGateway: boolean;
}

export interface CheckoutResult {
  groupId: string;
  orders: Order[];
  payment: { groupId: string; amount: number; status: string };
  replayed?: boolean;
}

/** Delivery partner's view of a delivery */
export interface Delivery {
  id: string;
  orderId: string;
  orderRef: string;
  status: DeliveryStatus;
  farmName: string;
  itemCount: number;
  items?: string[];
  pickupAddress: string;
  dropAddress: string | null;
  pickupPhone: string | null;
  dropPhone: string | null;
  orderTotal: number;
  paymentNote: string;
  lat: number | null;
  lng: number | null;
  locationUpdatedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  mine: boolean;
}

export interface Notification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface Complaint {
  id: string;
  subject: string;
  description: string;
  status: 'OPEN' | 'RESOLVED';
  resolutionNotes: string | null;
  createdAt: string;
  orderId: string | null;
  orderRef?: string | null;
  filedBy?: { id: string; name: string; role: Role };
  against?: { id: string; name: string; role: Role } | null;
}

export interface AuditLogRow {
  id: string;
  action: string;
  entity: string | null;
  detail: string | null;
  createdAt: string;
  actor: { name: string; email: string; role: Role } | null;
}
