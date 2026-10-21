/**
 * ---- Delivery-partner demo fixtures (deterministic, fictional, labelled) ----
 *
 * These feed the Own Delivery Partners page. Values are fixed (not random) so
 * the seed is reproducible and KPI cards always agree with the rows they are
 * computed from. Every phone and vehicle number is fictional; no real PII.
 */
export const DEMO_PARTNER_AREAS: Record<string, string> = {
  Chennai: 'T Nagar',
  Coimbatore: 'Gandhipuram',
  Madurai: 'KK Nagar',
};

export interface DemoPartner {
  name: string;
  zoneName: string;
  phone: string;
  vehicleType: string;
  vehicleNo: string;
  status: 'ACTIVE' | 'VERIFIED' | 'PENDING_VERIFICATION' | 'INACTIVE' | 'SUSPENDED';
  isOnline: boolean;
  ratingAvg: number | null;
  deliveriesCount: number;
  ordersAssigned: number;
  failedDeliveries: number;
  avgDeliveryMinutes: number | null;
  onTimePct: number | null;
  earningsPaise: number;
  cashInHand: number;
  settlementStatus: 'PENDING' | 'PARTIAL' | 'SETTLED';
}

export const DEMO_PARTNERS: DemoPartner[] = [
  {
    name: 'Arun Kumar',
    zoneName: 'Chennai',
    phone: '+919840011221',
    vehicleType: 'Bike',
    vehicleNo: 'TN 09 AR 4821',
    status: 'ACTIVE',
    isOnline: true,
    ratingAvg: 4.8,
    deliveriesCount: 214,
    ordersAssigned: 231,
    failedDeliveries: 6,
    avgDeliveryMinutes: 27,
    onTimePct: 94,
    earningsPaise: 4865000,
    cashInHand: 125000,
    settlementStatus: 'SETTLED',
  },
  {
    name: 'Priya Sundaram',
    zoneName: 'Chennai',
    phone: '+919840011222',
    vehicleType: 'Scooter',
    vehicleNo: 'TN 10 BR 7734',
    status: 'ACTIVE',
    isOnline: true,
    ratingAvg: 4.6,
    deliveriesCount: 168,
    ordersAssigned: 175,
    failedDeliveries: 3,
    avgDeliveryMinutes: 31,
    onTimePct: 91,
    earningsPaise: 3720000,
    cashInHand: 45000,
    settlementStatus: 'PARTIAL',
  },
  {
    name: 'Vignesh Murugan',
    zoneName: 'Chennai',
    phone: '+919840011223',
    vehicleType: 'Bike',
    vehicleNo: 'TN 09 CZ 1198',
    status: 'VERIFIED',
    isOnline: false,
    ratingAvg: 4.2,
    deliveriesCount: 96,
    ordersAssigned: 104,
    failedDeliveries: 5,
    avgDeliveryMinutes: 34,
    onTimePct: 88,
    earningsPaise: 2015000,
    cashInHand: 0,
    settlementStatus: 'PENDING',
  },
  {
    name: 'Karthik Raja',
    zoneName: 'Coimbatore',
    phone: '+919840011224',
    vehicleType: 'Bike',
    vehicleNo: 'TN 38 DR 5560',
    status: 'ACTIVE',
    isOnline: true,
    ratingAvg: 4.9,
    deliveriesCount: 251,
    ordersAssigned: 262,
    failedDeliveries: 4,
    avgDeliveryMinutes: 25,
    onTimePct: 96,
    earningsPaise: 5480000,
    cashInHand: 210000,
    settlementStatus: 'SETTLED',
  },
  {
    name: 'Deepika Nair',
    zoneName: 'Coimbatore',
    phone: '+919840011225',
    vehicleType: 'Scooter',
    vehicleNo: 'TN 37 EF 2287',
    status: 'INACTIVE',
    isOnline: false,
    ratingAvg: 4.0,
    deliveriesCount: 72,
    ordersAssigned: 80,
    failedDeliveries: 6,
    avgDeliveryMinutes: 38,
    onTimePct: 82,
    earningsPaise: 1490000,
    cashInHand: 0,
    settlementStatus: 'PENDING',
  },
  {
    name: 'Suresh Babu',
    zoneName: 'Coimbatore',
    phone: '+919840011226',
    vehicleType: 'Auto',
    vehicleNo: 'TN 38 AU 9013',
    status: 'SUSPENDED',
    isOnline: false,
    ratingAvg: 3.4,
    deliveriesCount: 41,
    ordersAssigned: 58,
    failedDeliveries: 12,
    avgDeliveryMinutes: 46,
    onTimePct: 71,
    earningsPaise: 980000,
    cashInHand: 0,
    settlementStatus: 'PENDING',
  },
  {
    name: 'Muthu Selvan',
    zoneName: 'Madurai',
    phone: '+919840011227',
    vehicleType: 'Bike',
    vehicleNo: 'TN 58 GH 3345',
    status: 'ACTIVE',
    isOnline: true,
    ratingAvg: 4.7,
    deliveriesCount: 189,
    ordersAssigned: 198,
    failedDeliveries: 4,
    avgDeliveryMinutes: 29,
    onTimePct: 93,
    earningsPaise: 4110000,
    cashInHand: 88000,
    settlementStatus: 'PARTIAL',
  },
  {
    name: 'Lakshmi Priya',
    zoneName: 'Madurai',
    phone: '+919840011228',
    vehicleType: 'Scooter',
    vehicleNo: 'TN 58 JK 6672',
    status: 'PENDING_VERIFICATION',
    isOnline: false,
    ratingAvg: null,
    deliveriesCount: 0,
    ordersAssigned: 0,
    failedDeliveries: 0,
    avgDeliveryMinutes: null,
    onTimePct: null,
    earningsPaise: 0,
    cashInHand: 0,
    settlementStatus: 'PENDING',
  },
  {
    name: 'Ravi Chandran',
    zoneName: 'Madurai',
    phone: '+919840011229',
    vehicleType: 'Bike',
    vehicleNo: 'TN 58 LM 8890',
    status: 'VERIFIED',
    isOnline: false,
    ratingAvg: 4.3,
    deliveriesCount: 112,
    ordersAssigned: 121,
    failedDeliveries: 7,
    avgDeliveryMinutes: 33,
    onTimePct: 87,
    earningsPaise: 2450000,
    cashInHand: 15000,
    settlementStatus: 'PENDING',
  },
];

/**
 * ---- Third-party provider demo fixtures (deterministic, fictional) ----
 *
 * These feed the Third-Party Partners page. Providers are external delivery
 * companies â€” distinct from the own partners above. `integrationStatus` is a
 * configuration flag only: CONFIGURED never means a live API connection (no
 * credentials or connectivity exist). Coverage spans multiple zones, so KPI
 * sums must be read from the rows rather than assumed.
 */
export interface DemoProvider {
  name: string;
  providerType: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  zoneNames: string[];
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  integrationStatus: 'NOT_CONFIGURED' | 'CONFIGURED';
  deliveriesCount: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  avgDeliveryMinutes: number | null;
  providerCostPaise: number;
  settlementStatus: 'PENDING' | 'PARTIAL' | 'SETTLED';
}

export const DEMO_PROVIDERS: DemoProvider[] = [
  {
    name: 'SwiftDrop Logistics',
    providerType: 'API',
    contactPerson: 'Anitha Rajan',
    contactEmail: 'ops@swiftdrop.example',
    contactPhone: '+919840022101',
    zoneNames: ['Chennai', 'Coimbatore'],
    status: 'ACTIVE',
    integrationStatus: 'CONFIGURED',
    deliveriesCount: 1420,
    successfulDeliveries: 1361,
    failedDeliveries: 59,
    avgDeliveryMinutes: 33,
    providerCostPaise: 18940000,
    settlementStatus: 'SETTLED',
  },
  {
    name: 'Nimbus Express',
    providerType: 'API',
    contactPerson: 'Franklin Dsouza',
    contactEmail: 'partners@nimbus.example',
    contactPhone: '+919840022102',
    zoneNames: ['Chennai', 'Madurai', 'Coimbatore'],
    status: 'ACTIVE',
    integrationStatus: 'CONFIGURED',
    deliveriesCount: 2210,
    successfulDeliveries: 2104,
    failedDeliveries: 106,
    avgDeliveryMinutes: 29,
    providerCostPaise: 31250000,
    settlementStatus: 'PARTIAL',
  },
  {
    name: 'Coromandel Courier',
    providerType: 'Webhook',
    contactPerson: 'Selvi Arumugam',
    contactEmail: 'dispatch@coromandel.example',
    contactPhone: '+919840022103',
    zoneNames: ['Coimbatore'],
    status: 'INACTIVE',
    integrationStatus: 'NOT_CONFIGURED',
    deliveriesCount: 340,
    successfulDeliveries: 305,
    failedDeliveries: 35,
    avgDeliveryMinutes: 41,
    providerCostPaise: 4720000,
    settlementStatus: 'PENDING',
  },
  {
    name: 'Bay Logistics',
    providerType: 'Manual',
    contactPerson: 'Hariharan V',
    contactEmail: 'support@baylogistics.example',
    contactPhone: '+919840022104',
    zoneNames: ['Chennai'],
    status: 'SUSPENDED',
    integrationStatus: 'NOT_CONFIGURED',
    deliveriesCount: 128,
    successfulDeliveries: 98,
    failedDeliveries: 30,
    avgDeliveryMinutes: 52,
    providerCostPaise: 1980000,
    settlementStatus: 'PENDING',
  },
  {
    name: 'Kaveri Freight Partners',
    providerType: 'API',
    contactPerson: 'Meenakshi Sundaram',
    contactEmail: 'integration@kaverifreight.example',
    contactPhone: '+919840022105',
    zoneNames: ['Madurai', 'Chennai'],
    status: 'ACTIVE',
    integrationStatus: 'NOT_CONFIGURED',
    deliveriesCount: 870,
    successfulDeliveries: 812,
    failedDeliveries: 58,
    avgDeliveryMinutes: 36,
    providerCostPaise: 11430000,
    settlementStatus: 'PENDING',
  },
];
