import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { NumericFormat } from 'react-number-format'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3333/api'

type PageId = 'dashboard' | 'clientes' | 'sleepLab' | 'estoque' | 'entregas' | 'assistencias' | 'financeiro'

type NavItem = {
  id: PageId
  label: string
  icon: string
}

type Client = {
  id: string
  name: string
  phone: string
  cpf: string
  addressStreet: string
  addressNumber: string
  addressNeighborhood: string
  addressCity: string
  addressNote: string
  createdAt: string
}

type StockItem = {
  id: string
  name: string
  sku: string
  quantity: number
  reserved: number
  price: number
  imageUrl: string
}

type StockMovement = {
  id: string
  productId: string
  type: 'entrada' | 'saida'
  amount: number
  note: string
  createdAt: string
}

type SaleItem = {
  productId: string
  productName?: string
  quantity: number
  unitPrice: number
  discount: number
}

type PaymentMethod = 'PIX' | 'Cartão de crédito' | 'Cartão de débito' | 'Dinheiro'

type SalePayment = {
  id: string
  method: PaymentMethod
  amount: number
  installments: number
}

type Sale = {
  id: string
  backendId?: string
  clientId: string
  clientName?: string
  items: SaleItem[]
  value: number
  discount: number
  payments: SalePayment[]
  note: string
  status: 'pendente' | 'entregue'
  createdAt: string
  deliveryDate: string
}

type SaleFormState = {
  clientId: string
  items: SaleItem[]
  payments: SalePayment[]
  discount: number
  note: string
  deliveryDate: string
}

type SearchResult = {
  id: string
  type: 'Cliente' | 'Estoque' | 'Venda' | 'Movimento'
  title: string
  description: string
  page: PageId
  payload?: string
}

type UserRole = 'admin' | 'seller'

type User = {
  id: string
  name: string
  role: UserRole
  email: string
  phone: string
  password?: string
  active: boolean
}

type Assistance = {
  id: string
  code: string
  saleId: string
  saleCode: string
  productId: string
  productName?: string
  defectDescription: string
  factoryResponse: string
  expectedDate: string
  status: 'aberta' | 'concluida'
  createdAt: string
  photos: string[]
  owner: string
}

type FinanceSummary = {
  totalRevenue: number
  discountTotal: number
  delivered: number
  pending: number
  paymentsByMethod: Record<string, number>
  monthlySeries: Record<string, number>
}

type MonthlyGoal = {
  year: number
  month: number
  target: number
  progress: number
}

const normalizeClient = (client: any): Client => ({
  id: client.id,
  name: client.name ?? '',
  phone: client.phone ?? '',
  cpf: client.cpf ?? '',
  addressStreet: client.addressStreet ?? '',
  addressNumber: client.addressNumber ?? '',
  addressNeighborhood: client.addressNeighborhood ?? '',
  addressCity: client.addressCity ?? '',
  addressNote: client.addressNote ?? '',
  createdAt: client.createdAt ?? new Date().toISOString(),
})

const mapPaymentMethodFromApi = (method: string): PaymentMethod => {
  switch (method) {
    case 'CARTAO_CREDITO':
      return 'Cartão de crédito'
    case 'CARTAO_DEBITO':
      return 'Cartão de débito'
    case 'DINHEIRO':
      return 'Dinheiro'
    default:
      return 'PIX'
  }
}

const normalizeSale = (sale: any): Sale => ({
  backendId: sale.id,
  id: sale.publicId ?? sale.id,
  clientId: sale.client?.id ?? sale.clientId ?? '',
  clientName: sale.client?.name ?? sale.clientName ?? '',
  items: Array.isArray(sale.items)
    ? sale.items.map((item: any) => ({
        productId: item.productId ?? item.product?.id ?? '',
        productName: item.product?.name ?? '',
        quantity: item.quantity ?? 0,
        unitPrice: item.unitPrice ?? 0,
        discount: item.discount ?? 0,
      }))
    : [],
  value: sale.value ?? 0,
  discount: sale.discount ?? 0,
  payments: Array.isArray(sale.payments)
    ? sale.payments.map((payment: any) => ({
        id: payment.id ?? `${sale.id}-${Math.random()}`,
        method: mapPaymentMethodFromApi(payment.method),
        amount: payment.amount ?? 0,
        installments: payment.installments ?? 1,
      }))
    : [],
  note: sale.note ?? '',
  status: sale.status === 'entregue' ? 'entregue' : 'pendente',
  createdAt: sale.createdAt ?? new Date().toISOString(),
  deliveryDate: sale.deliveryDate ? sale.deliveryDate.slice(0, 10) : '',
})

const DEFAULT_PRODUCT_IMAGE =
  'https://images.unsplash.com/photo-1616594039964-42d379c6810d?auto=format&fit=crop&w=400&q=60'

const normalizeStockItem = (product: any): StockItem => ({
  id: product.id,
  name: product.name ?? '',
  sku: product.sku ?? '',
  quantity: product.quantity ?? 0,
  reserved: product.reserved ?? 0,
  price: product.price ?? 0,
  imageUrl: product.imageUrl ?? DEFAULT_PRODUCT_IMAGE,
})

const normalizeMovement = (movement: any): StockMovement => ({
  id: movement.id,
  productId: movement.productId ?? movement.product?.id ?? '',
  type: movement.type === 'saida' ? 'saida' : 'entrada',
  amount: movement.amount ?? 0,
  note: movement.note ?? '',
  createdAt: movement.createdAt ?? new Date().toISOString(),
})

const normalizeAssistance = (assistance: any): Assistance => ({
  id: assistance.id,
  code: assistance.code ?? assistance.id,
  saleId: assistance.saleId ?? assistance.sale?.id ?? '',
  saleCode: assistance.sale?.publicId ?? assistance.sale?.id ?? assistance.saleId ?? '',
  productId: assistance.productId ?? assistance.product?.id ?? '',
  productName: assistance.product?.name ?? '',
  defectDescription: assistance.defectDescription ?? '',
  factoryResponse: assistance.factoryResponse ?? '',
  expectedDate: assistance.expectedDate ? new Date(assistance.expectedDate).toISOString() : new Date().toISOString(),
  status: assistance.status === 'concluida' ? 'concluida' : 'aberta',
  createdAt: assistance.createdAt ?? new Date().toISOString(),
  photos: Array.isArray(assistance.photos) ? assistance.photos : [],
  owner: assistance.owner?.name ?? assistance.ownerName ?? 'Equipe Sonhar',
})

const normalizeUserFromApi = (user: any): User => ({
  id: user.id,
  name: user.name ?? '',
  email: user.email ?? '',
  phone: user.phone ?? '',
  role: user.role === 'admin' ? 'admin' : 'seller',
  active: user.active ?? true,
})

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'M4 4h16v6H4z M4 12h8v8H4z M14 12h6v8h-6z' },
  { id: 'clientes', label: 'Clientes', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-6 2-6 4v1h12v-1c0-2-2.7-4-6-4z' },
  { id: 'sleepLab', label: 'Sleep Lab', icon: 'M3 7h18v3H3V7zm2 3h14v7h-2v-3H7v3H5v-7z' },
  { id: 'estoque', label: 'Estoque', icon: 'M5 5h14v4H5zm0 6h14v8H5z' },
  { id: 'entregas', label: 'Entregas', icon: 'M4 5h16v2H4zm0 6h16v2H4zm0 6h16v2H4z' },
  { id: 'assistencias', label: 'Assistências', icon: 'M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z' },
  { id: 'financeiro', label: 'Financeiro', icon: 'M4 4h16v16H4z M8 8h2v8H8zm6 2h2v6h-2z' },
]

const paymentMethods: PaymentMethod[] = ['PIX', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro']

const paymentMethodLabelFromKey = (method: string): string => {
  const normalized = method.toUpperCase()
  switch (normalized) {
    case 'PIX':
      return 'PIX'
    case 'CARTAO_CREDITO':
    case 'CARTÃO_CREDITO':
    case 'CARTAO_DE_CREDITO':
      return 'Cartão de crédito'
    case 'CARTAO_DEBITO':
    case 'CARTÃO_DEBITO':
    case 'CARTAO_DE_DEBITO':
      return 'Cartão de débito'
    case 'DINHEIRO':
      return 'Dinheiro'
    default:
      return method
  }
}

const roleLabels: Record<UserRole, string> = {
  admin: 'Administrador',
  seller: 'Consultor de vendas',
}


const MAX_ASSISTANCE_PHOTOS = 4

const initialClients: Client[] = []

const initialStock: StockItem[] = []

const initialSales: Sale[] = []

const initialAssistances: Assistance[] = []

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)

const generateSaleId = () => 'VEN-0000'

type InventoryFormState = {
  productId: string
  amount: number
  note: string
  type: StockMovement['type']
  isNewProduct: boolean
  newProductName: string
  newProductSku: string
  newProductPrice: string
  newProductImage: string
}

const createInventoryFormState = (productId: string): InventoryFormState => ({
  productId,
  amount: 1,
  note: '',
  type: 'entrada',
  isNewProduct: false,
  newProductName: '',
  newProductSku: '',
  newProductPrice: '',
  newProductImage: '',
})

const createSaleFormState = (clientsList: Client[]): SaleFormState => {
  const firstClient = clientsList[0]?.id ?? ''
  return {
    clientId: firstClient,
    items: [],
    payments: [
      {
        id: `pay-${Date.now()}`,
        method: 'PIX',
        amount: 0,
        installments: 1,
      },
    ],
    discount: 0,
    note: '',
    deliveryDate: new Date().toISOString().slice(0, 10),
  }
}

const createAssistanceFormState = (salesList: Sale[]): {
  saleId: string
  productId: string
  defectDescription: string
  factoryResponse: string
  expectedDate: string
  photos: string[]
} => {
  const firstSale = salesList[0]
  return {
    saleId: firstSale ? firstSale.backendId ?? firstSale.id : '',
    productId: firstSale?.items[0]?.productId ?? '',
    defectDescription: '',
    factoryResponse: '',
    expectedDate: new Date().toISOString().slice(0, 10),
    photos: [],
  }
}

function App() {
  const [collapsed, setCollapsed] = useState(true)
  const [activePage, setActivePage] = useState<PageId>('dashboard')
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [stockItems, setStockItems] = useState<StockItem[]>(initialStock)
  const [stockLoading, setStockLoading] = useState(false)
  const [stockError, setStockError] = useState<string | null>(null)
  const [sales, setSales] = useState<Sale[]>(initialSales)
  const [salesLoading, setSalesLoading] = useState(false)
  const [salesError, setSalesError] = useState<string | null>(null)
  const [saleForm, setSaleForm] = useState<SaleFormState>(() => createSaleFormState(initialClients))
  const [saleModalOpen, setSaleModalOpen] = useState(false)
  const [saleModalError, setSaleModalError] = useState<string | null>(null)
  const [saleModalLoading, setSaleModalLoading] = useState(false)
  const [saleDraftId, setSaleDraftId] = useState(generateSaleId())
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [receiptModalOpen, setReceiptModalOpen] = useState(false)
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null)
  const [confirmDeliveryState, setConfirmDeliveryState] = useState<{
    sale: Sale
    redirect?: PageId
  } | null>(null)
  const [inventoryForm, setInventoryForm] = useState<InventoryFormState>(createInventoryFormState(initialStock[0]?.id ?? ''))
  const [inventoryPanelOpen, setInventoryPanelOpen] = useState(false)
  const [inventorySubmitLoading, setInventorySubmitLoading] = useState(false)
  const [inventorySubmitError, setInventorySubmitError] = useState<string | null>(null)
  const emptyClientForm = {
    name: '',
    phone: '',
    cpf: '',
    addressStreet: '',
    addressNumber: '',
    addressNeighborhood: '',
    addressCity: '',
    addressNote: '',
  }
  const [clientModalOpen, setClientModalOpen] = useState(false)
  const [clientModalMode, setClientModalMode] = useState<'create' | 'edit'>('create')
  const [clientModalClientId, setClientModalClientId] = useState<string | null>(null)
  const [clientModalForm, setClientModalForm] = useState(emptyClientForm)
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientFetchError, setClientFetchError] = useState<string | null>(null)
  const [clientModalError, setClientModalError] = useState<string | null>(null)
  const [clientModalLoading, setClientModalLoading] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [clientFilter, setClientFilter] = useState<'all' | 'withSales' | 'withoutSales'>('all')
  const [clientDateStart, setClientDateStart] = useState('')
  const [clientDateEnd, setClientDateEnd] = useState('')
  const [clientCityFilter, setClientCityFilter] = useState('all')
  const [stockSearch, setStockSearch] = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'reserved'>('all')
  const [stockMinValue, setStockMinValue] = useState('')
  const [stockMaxValue, setStockMaxValue] = useState('')
  const [saleSearch, setSaleSearch] = useState('')
  const [saleFilter, setSaleFilter] = useState<'all' | 'pendente' | 'entregue'>('all')
  const [saleDateStart, setSaleDateStart] = useState('')
  const [saleDateEnd, setSaleDateEnd] = useState('')
  const [salePaymentFilter, setSalePaymentFilter] = useState<'all' | PaymentMethod>('all')
  const [saleMinValue, setSaleMinValue] = useState('')
  const [financeDateStart, setFinanceDateStart] = useState('')
  const [financeDateEnd, setFinanceDateEnd] = useState('')
  const [financePaymentFilter, setFinancePaymentFilter] = useState<'all' | PaymentMethod>('all')
  const [financeMinValue, setFinanceMinValue] = useState('')
  const [financeMaxValue, setFinanceMaxValue] = useState('')
  const [financeClientFilter, setFinanceClientFilter] = useState('all')
  const [monthlyGoal, setMonthlyGoal] = useState<MonthlyGoal | null>(null)
  const [monthlyGoalLoading, setMonthlyGoalLoading] = useState(false)
  const [monthlyGoalError, setMonthlyGoalError] = useState<string | null>(null)
  const [monthlyGoalFormValue, setMonthlyGoalFormValue] = useState(0)
  const [monthlyGoalSaving, setMonthlyGoalSaving] = useState(false)
  const [monthlyGoalNotice, setMonthlyGoalNotice] = useState<string | null>(null)
  const [financeSummary, setFinanceSummary] = useState<FinanceSummary | null>(null)
  const [financeSummaryLoading, setFinanceSummaryLoading] = useState(false)
  const [financeSummaryError, setFinanceSummaryError] = useState<string | null>(null)
  const [stockExploreTerm, setStockExploreTerm] = useState('')
  const [globalSearch, setGlobalSearch] = useState('')
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'pendente' | 'entregue'>('all')
  const [movementTypeFilter, setMovementTypeFilter] = useState<'all' | 'entrada' | 'saida'>('all')
  const [movementDateStart, setMovementDateStart] = useState('')
  const [movementDateEnd, setMovementDateEnd] = useState('')
  const [deliveryMonthOffset, setDeliveryMonthOffset] = useState(0)
  const [searchFocused, setSearchFocused] = useState(false)
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null)
  const receiptContentRef = useRef<HTMLDivElement | null>(null)
  const inventoryPanelRef = useRef<HTMLElement | null>(null)
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [assistances, setAssistances] = useState<Assistance[]>(initialAssistances)
  const [assistancesLoading, setAssistancesLoading] = useState(false)
  const [assistancesError, setAssistancesError] = useState<string | null>(null)
  const [assistanceSubmitLoading, setAssistanceSubmitLoading] = useState(false)
  const [assistanceSubmitError, setAssistanceSubmitError] = useState<string | null>(null)
  const [assistanceStatusLoading, setAssistanceStatusLoading] = useState(false)
  const [assistanceForm, setAssistanceForm] = useState(() => createAssistanceFormState(initialSales))
  const [assistanceModal, setAssistanceModal] = useState<Assistance | null>(null)
  const [assistanceSearch, setAssistanceSearch] = useState('')
  const [assistanceStatusFilter, setAssistanceStatusFilter] = useState<'all' | 'aberta' | 'concluida'>('all')
  const [assistanceDateStart, setAssistanceDateStart] = useState('')
  const [assistanceDateEnd, setAssistanceDateEnd] = useState('')
  const [assistanceConfirm, setAssistanceConfirm] = useState<Assistance | null>(null)
  const [userManagerOpen, setUserManagerOpen] = useState(false)
  const [userForm, setUserForm] = useState({ name: '', email: '', phone: '', role: 'seller' as UserRole })
  const [userManagerNotice, setUserManagerNotice] = useState<string | null>(null)
  const [userInviteTempPassword, setUserInviteTempPassword] = useState<string | null>(null)
  const [userActionError, setUserActionError] = useState<string | null>(null)
  const [userActionLoading, setUserActionLoading] = useState(false)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('auth_token'))
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const currentUser = sessionUserId ? users.find((user) => user.id === sessionUserId && user.active) ?? null : null
  const isAdmin = currentUser?.role === 'admin'
  const canRegisterClients = Boolean(currentUser)
  const canEditClients = isAdmin
  const canDeleteClients = isAdmin
  const canRegisterSales = Boolean(currentUser)
  const canManageStock = isAdmin

  const getAuthHeaders = (withJson = true) => {
    const token = authToken ?? localStorage.getItem('auth_token')
    const headers: Record<string, string> = {}
    if (withJson) headers['Content-Type'] = 'application/json'
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGlobalSearch('')
        setSearchFocused(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!canManageStock) {
      setInventoryPanelOpen(false)
    }
  }, [canManageStock])

  useEffect(() => {
    if (!isAdmin) {
      setUserManagerOpen(false)
    }
  }, [isAdmin])

  useEffect(() => {
    if (sessionUserId && !users.some((user) => user.id === sessionUserId)) {
      setSessionUserId(null)
    }
  }, [sessionUserId, users])

  const fetchClientsFromApi = useCallback(async () => {
    if (!authToken) return
    setClientsLoading(true)
    setClientFetchError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/clients`, {
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível carregar os clientes.')
      }
      const data = await response.json()
      const normalized = Array.isArray(data) ? data.map((client: any) => normalizeClient(client)) : []
      setClients(normalized)
      setSaleForm((prev) => {
        if (prev.clientId && normalized.some((client) => client.id === prev.clientId)) {
          return prev
        }
        return { ...prev, clientId: normalized[0]?.id ?? '' }
      })
    } catch (error) {
      console.error(error)
      setClientFetchError(error instanceof Error ? error.message : 'Falha ao carregar clientes.')
      setClients([])
    } finally {
      setClientsLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    if (!authToken) {
      setClients([])
      setClientFetchError(null)
      return
    }
    fetchClientsFromApi()
  }, [authToken, fetchClientsFromApi])

  const fetchStockFromApi = useCallback(async () => {
    if (!authToken) return
    setStockLoading(true)
    setStockError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/stock`, {
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível carregar o estoque.')
      }
      const data = await response.json()
      const normalized = Array.isArray(data) ? data.map((item: any) => normalizeStockItem(item)) : []
      setStockItems(normalized)
      setInventoryForm((prev) => {
        if (prev.isNewProduct || normalized.length === 0) {
          return { ...prev, productId: normalized[0]?.id ?? '' }
        }
        if (normalized.some((item) => item.id === prev.productId)) {
          return prev
        }
        return { ...prev, productId: normalized[0]?.id ?? '' }
      })
    } catch (error) {
      console.error(error)
      setStockError(error instanceof Error ? error.message : 'Falha ao carregar estoque.')
      setStockItems([])
    } finally {
      setStockLoading(false)
    }
  }, [authToken])

  const fetchStockMovementsFromApi = useCallback(async () => {
    if (!authToken) return
    setStockMovementsLoading(true)
    setStockMovementsError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/stock/movements`, {
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível carregar os movimentos.')
      }
      const data = await response.json()
      const normalized = Array.isArray(data) ? data.map((movement: any) => normalizeMovement(movement)) : []
      setStockMovements(normalized)
    } catch (error) {
      console.error(error)
      setStockMovementsError(error instanceof Error ? error.message : 'Falha ao carregar movimentos.')
      setStockMovements([])
    } finally {
      setStockMovementsLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    if (!authToken) {
      setStockItems([])
      setStockMovements([])
      setStockError(null)
      setStockMovementsError(null)
      return
    }
    fetchStockFromApi()
    fetchStockMovementsFromApi()
  }, [authToken, fetchStockFromApi, fetchStockMovementsFromApi])

  const fetchSalesFromApi = useCallback(async () => {
    if (!authToken) return
    setSalesLoading(true)
    setSalesError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/sales`, {
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível carregar as vendas.')
      }
      const data = await response.json()
      const normalized = Array.isArray(data) ? data.map((sale: any) => normalizeSale(sale)) : []
      setSales(normalized)
    } catch (error) {
      console.error(error)
      setSalesError(error instanceof Error ? error.message : 'Falha ao carregar vendas.')
      setSales([])
    } finally {
      setSalesLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    if (!authToken) {
      setSales([])
      setSalesError(null)
      return
    }
    fetchSalesFromApi()
  }, [authToken, fetchSalesFromApi])

  const fetchUsersFromApi = useCallback(async () => {
    if (!authToken || !isAdmin) return
    setUsersLoading(true)
    setUsersError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/users`, {
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível carregar os usuários.')
      }
      const data = await response.json()
      const normalized = Array.isArray(data) ? data.map((user: any) => normalizeUserFromApi(user)) : []
      setUsers((prev) => {
        if (!prev.length) return normalized
        const map = new Map<string, User>()
        normalized.forEach((user) => map.set(user.id, user))
        prev.forEach((user) => {
          if (!map.has(user.id)) {
            map.set(user.id, user)
          }
        })
        return Array.from(map.values())
      })
    } catch (error) {
      console.error(error)
      setUsersError(error instanceof Error ? error.message : 'Falha ao carregar usuários.')
    } finally {
      setUsersLoading(false)
    }
  }, [authToken, isAdmin])

  useEffect(() => {
    if (!authToken || !isAdmin) return
    fetchUsersFromApi()
  }, [authToken, isAdmin, fetchUsersFromApi])

  const fetchFinanceSummaryFromApi = useCallback(async () => {
    if (!authToken || !isAdmin) return
    setFinanceSummaryLoading(true)
    setFinanceSummaryError(null)
    try {
      const params = new URLSearchParams()
      if (financeDateStart) params.append('start', financeDateStart)
      if (financeDateEnd) params.append('end', financeDateEnd)
      const query = params.toString()
      const response = await fetch(`${API_BASE_URL}/finance/summary${query ? `?${query}` : ''}`, {
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível carregar os indicadores financeiros.')
      }
      const data = await response.json()
      setFinanceSummary(data)
    } catch (error) {
      console.error(error)
      setFinanceSummary(null)
      setFinanceSummaryError(error instanceof Error ? error.message : 'Falha ao carregar finance.')
    } finally {
      setFinanceSummaryLoading(false)
    }
  }, [authToken, financeDateStart, financeDateEnd, isAdmin])

  useEffect(() => {
    if (!authToken || !isAdmin) {
      setFinanceSummary(null)
      setFinanceSummaryError(null)
      return
    }
    fetchFinanceSummaryFromApi()
  }, [authToken, isAdmin, financeDateStart, financeDateEnd, fetchFinanceSummaryFromApi, sales.length])

  const fetchMonthlyGoalFromApi = useCallback(async () => {
    if (!authToken) return
    setMonthlyGoalLoading(true)
    setMonthlyGoalError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/finance/goal`, {
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível carregar a meta do mês.')
      }
      const data = await response.json()
      setMonthlyGoal(data)
      setMonthlyGoalFormValue(data.target ?? 0)
    } catch (error) {
      console.error(error)
      setMonthlyGoal(null)
      setMonthlyGoalError(error instanceof Error ? error.message : 'Falha ao carregar meta do mês.')
    } finally {
      setMonthlyGoalLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    if (!authToken) {
      setMonthlyGoal(null)
      setMonthlyGoalError(null)
      setMonthlyGoalFormValue(0)
      return
    }
    fetchMonthlyGoalFromApi()
  }, [authToken, sales.length, fetchMonthlyGoalFromApi])

  useEffect(() => {
    if (userManagerOpen && isAdmin) {
      fetchUsersFromApi()
    }
  }, [userManagerOpen, isAdmin, fetchUsersFromApi])

  const fetchAssistancesFromApi = useCallback(async () => {
    if (!authToken) return
    setAssistancesLoading(true)
    setAssistancesError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/assistances`, {
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível carregar as assistências.')
      }
      const data = await response.json()
      const normalized = Array.isArray(data) ? data.map((item: any) => normalizeAssistance(item)) : []
      setAssistances(normalized)
    } catch (error) {
      console.error(error)
      setAssistancesError(error instanceof Error ? error.message : 'Falha ao carregar assistências.')
      setAssistances([])
    } finally {
      setAssistancesLoading(false)
    }
  }, [authToken])

  useEffect(() => {
    if (!authToken) {
      setAssistances([])
      setAssistancesError(null)
      return
    }
    fetchAssistancesFromApi()
  }, [authToken, fetchAssistancesFromApi])

  useEffect(() => {
    const token = authToken ?? localStorage.getItem('auth_token')
    if (!token) {
      setSessionUserId(null)
      return
    }
    let isActive = true
    const fetchSession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          throw new Error('Sessão expirada. Faça login novamente.')
        }
        const data = await response.json()
        if (!isActive) return
        const normalizedUser = normalizeUserFromApi({ ...data, name: data.name ?? 'Usuário' })
        setUsers((prev) => {
          const exists = prev.some((user) => user.id === normalizedUser.id)
          if (exists) {
            return prev.map((user) => (user.id === normalizedUser.id ? normalizedUser : user))
          }
          return [...prev, normalizedUser]
        })
        setSessionUserId(normalizedUser.id)
      } catch (error) {
        console.error(error)
        localStorage.removeItem('auth_token')
        setAuthToken(null)
        setSessionUserId(null)
      }
    }
    fetchSession()
    return () => {
      isActive = false
    }
  }, [authToken])

  useEffect(() => {
    if (!isAdmin && activePage === 'financeiro') {
      setActivePage('dashboard')
    }
  }, [isAdmin, activePage])

  useEffect(() => {
    setAssistanceForm((prev) => {
      const findByBackend = (sale: Sale) => (sale.backendId ?? sale.id) === prev.saleId
      const saleExists = sales.some(findByBackend)
      const fallbackSale = sales[0]
      const nextSale = saleExists ? sales.find(findByBackend) ?? fallbackSale : fallbackSale
      const nextSaleId = nextSale ? nextSale.backendId ?? nextSale.id : ''
      const productExists = nextSale?.items.some((item) => item.productId === prev.productId)
      const nextProductId = productExists ? prev.productId : nextSale?.items[0]?.productId ?? ''
      return {
        ...prev,
        saleId: nextSaleId,
        productId: nextProductId,
      }
    })
  }, [sales])

  const todayIso = new Date().toISOString().slice(0, 10)
  const todayRevenue = sales
    .filter((sale) => sale.createdAt.slice(0, 10) === todayIso)
    .reduce((sum, sale) => sum + sale.value, 0)
  const pendingDeliveries = sales.filter((sale) => sale.status === 'pendente').length
  const confirmDeliveryClient = confirmDeliveryState
    ? clients.find((clientItem) => clientItem.id === confirmDeliveryState.sale.clientId)
    : null

  const facts = [
    { label: 'Clientes ativos', value: clients.length.toString(), detail: 'Cadastros no CRM' },
    { label: 'Receita de hoje', value: formatCurrency(todayRevenue), detail: 'Faturado até agora' },
    { label: 'Entregas pendentes', value: `${pendingDeliveries} vendas`, detail: 'Confirme após entrega' },
  ]

  const addClient = async (data: typeof emptyClientForm) => {
    if (!authToken) throw new Error('Sessão expirada. Faça login novamente.')
    if (!data.name.trim()) throw new Error('Informe o nome do cliente.')
    const payload = {
      name: data.name.trim(),
      phone: data.phone.trim(),
      cpf: data.cpf.trim(),
      addressStreet: data.addressStreet.trim(),
      addressNumber: data.addressNumber.trim(),
      addressNeighborhood: data.addressNeighborhood.trim(),
      addressCity: data.addressCity.trim(),
      addressNote: data.addressNote.trim(),
    }
    const response = await fetch(`${API_BASE_URL}/clients`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      throw new Error('Não foi possível cadastrar o cliente.')
    }
    const created = normalizeClient(await response.json())
    setClients((prev) => [created, ...prev])
    setSaleForm((prev) => (prev.clientId ? prev : { ...prev, clientId: created.id }))
    return created
  }

  const updateClientRecord = async (clientId: string, data: typeof emptyClientForm) => {
    if (!authToken) throw new Error('Sessão expirada. Faça login novamente.')
    const payload = {
      name: data.name.trim(),
      phone: data.phone.trim(),
      cpf: data.cpf.trim(),
      addressStreet: data.addressStreet.trim(),
      addressNumber: data.addressNumber.trim(),
      addressNeighborhood: data.addressNeighborhood.trim(),
      addressCity: data.addressCity.trim(),
      addressNote: data.addressNote.trim(),
    }
    const response = await fetch(`${API_BASE_URL}/clients/${clientId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      throw new Error('Não foi possível atualizar o cliente.')
    }
    const updated = normalizeClient(await response.json())
    setClients((prev) => prev.map((client) => (client.id === clientId ? updated : client)))
  }

  const deleteClientRecord = async (clientId: string) => {
    if (!authToken) throw new Error('Sessão expirada. Faça login novamente.')
    const response = await fetch(`${API_BASE_URL}/clients/${clientId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(false),
    })
    if (!response.ok) {
      throw new Error('Não foi possível remover o cliente.')
    }
    setClients((prev) => {
      const updated = prev.filter((client) => client.id !== clientId)
      setSaleForm((salePrev) => ({ ...salePrev, clientId: updated[0]?.id ?? '' }))
      return updated
    })
    setSales((prev) => prev.filter((sale) => sale.clientId !== clientId))
  }
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([])
  const [stockMovementsLoading, setStockMovementsLoading] = useState(false)
  const [stockMovementsError, setStockMovementsError] = useState<string | null>(null)

  const resetInventoryForm = (preferredProductId?: string) => {
    setInventoryForm(createInventoryFormState(preferredProductId ?? (stockItems[0]?.id ?? '')))
  }

  const openReceiptModal = (sale: Sale) => {
    setReceiptSale(sale)
    setReceiptModalOpen(true)
  }

  const focusInventoryPanel = (productId?: string) => {
    if (!canManageStock) return
    setInventoryPanelOpen(true)
    setInventoryForm((prev) => {
      if (!stockItems.length) {
        return {
          ...createInventoryFormState(''),
          isNewProduct: true,
          type: 'entrada',
        }
      }
      return {
        ...prev,
        productId: productId ?? prev.productId ?? stockItems[0]?.id ?? '',
        isNewProduct: false,
      }
    })
    requestAnimationFrame(() => {
      inventoryPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const formatDigits = (value: string) => value.replace(/\D/g, '')

  const formatCpf = (value: string) => {
    const digits = formatDigits(value).slice(0, 11)
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }

  const formatPhone = (value: string) => {
    const digits = formatDigits(value).slice(0, 11)
    if (digits.length <= 10) {
      return digits
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{4})(\d)/, '$1-$2')
    }
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  }

  const handleDownloadReceipt = async () => {
    if (!receiptSale || !receiptContentRef.current) return
    const sections = Array.from(receiptContentRef.current.querySelectorAll('.receipt-copy')) as HTMLElement[]
    if (!sections.length) return

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 12
    const usableWidth = pageWidth - margin * 2
    const usableHeight = pageHeight - margin * 2

    for (let index = 0; index < sections.length; index++) {
      const canvas = await html2canvas(sections[index], {
        scale: 2,
        backgroundColor: '#ffffff',
      })
      const imgData = canvas.toDataURL('image/png')
      const scaledHeight = (canvas.height * usableWidth) / canvas.width
      const renderHeight = Math.min(scaledHeight, usableHeight)
      const renderWidth = (canvas.width * renderHeight) / canvas.height
      if (index !== 0) {
        pdf.addPage()
      }
      const xPosition = margin + (usableWidth - renderWidth) / 2
      const yPosition = margin + (usableHeight - renderHeight) / 2
      pdf.addImage(imgData, 'PNG', xPosition, yPosition, renderWidth, renderHeight, undefined, 'FAST')
    }
    pdf.save(`recibo-${receiptSale.id}.pdf`)
  }

  const handleProductImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    if (!canManageStock) return
    const file = event.target.files?.[0]
    if (!file) {
      setInventoryForm((prev) => ({ ...prev, newProductImage: '' }))
      return
    }
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      if (typeof result === 'string') {
        setInventoryForm((prev) => ({ ...prev, newProductImage: result }))
      }
    }
    reader.readAsDataURL(file)
  }

  const saleSubtotal = saleForm.items.reduce((sum, item) => {
    const netUnit = Math.max(0, item.unitPrice - item.discount)
    return sum + item.quantity * netUnit
  }, 0)
  const normalizedDiscount = Math.min(Math.max(saleForm.discount, 0), saleSubtotal)
  const saleTotal = Math.max(0, saleSubtotal - normalizedDiscount)
  const paymentsTotal = saleForm.payments.reduce((sum, payment) => sum + Math.max(0, payment.amount), 0)
  const paymentDiff = saleTotal - paymentsTotal
  const paymentBalanced = Math.abs(paymentDiff) < 0.05
  const normalizedSearch = globalSearch.trim().toLowerCase()
  const calendarRange = Array.from({ length: 31 }, (_, index) => {
    const date = new Date()
    date.setDate(1)
    date.setMonth(date.getMonth() + deliveryMonthOffset)
    date.setDate(date.getDate() + index)
    return date.toISOString().slice(0, 10)
  })

  const searchResults: SearchResult[] = normalizedSearch
    ? [
        ...clients
          .filter((client) => {
            const blob = `${client.name ?? ''} ${client.phone ?? ''} ${client.addressCity ?? ''}`.toLowerCase()
            return blob.includes(normalizedSearch)
          })
          .map((client) => ({
            id: client.id,
            type: 'Cliente' as const,
            title: client.name,
            description: client.phone || client.addressCity || '',
            page: 'clientes' as PageId,
            payload: client.name,
          })),
        ...stockItems
          .filter((item) => `${item.name} ${item.sku}`.toLowerCase().includes(normalizedSearch))
          .map((item) => ({
            id: item.id,
            type: 'Estoque' as const,
            title: item.name,
            description: `SKU ${item.sku} · ${item.quantity} disponíveis`,
            page: 'estoque' as PageId,
            payload: item.name,
          })),
        ...sales
          .filter((sale) => {
            const client = clients.find((c) => c.id === sale.clientId)
            const products = sale.items
              .map((saleItem) => stockItems.find((stock) => stock.id === saleItem.productId)?.name ?? saleItem.productName ?? '')
              .join(' ')
            return `${sale.id} ${client?.name ?? sale.clientName ?? ''} ${products}`.toLowerCase().includes(normalizedSearch)
          })
          .map((sale) => {
            const client = clients.find((clientItem) => clientItem.id === sale.clientId)
            return {
              id: sale.id,
              type: 'Venda' as const,
              title: `Venda ${sale.id}`,
              description: `${client?.name ?? sale.clientName ?? 'Cliente removido'} · ${sale.items
                .map((saleItem) => stockItems.find((stock) => stock.id === saleItem.productId)?.name ?? saleItem.productName ?? '')
                .join(', ')}`,
              page: 'sleepLab' as PageId,
            }
          }),
        ...stockMovements
          .filter((movement) => {
            const product = stockItems.find((item) => item.id === movement.productId)
            return `${movement.type} ${movement.note} ${product?.name ?? ''}`.toLowerCase().includes(normalizedSearch)
          })
          .map((movement) => {
            const product = stockItems.find((item) => item.id === movement.productId)
            return {
              id: movement.id,
              type: 'Movimento' as const,
              title: `${movement.type === 'entrada' ? 'Entrada' : 'Saída'} · ${product?.name ?? 'Produto'}`,
              description: `${movement.amount} unidades em ${new Date(movement.createdAt).toLocaleDateString('pt-BR')}`,
              page: 'estoque' as PageId,
              payload: product?.name,
            }
          }),
      ].slice(0, 10)
    : []

  const handleSearchNavigate = (result: SearchResult) => {
    setGlobalSearch('')
    setSearchFocused(false)
    setActivePage(result.page)
    if (result.page === 'clientes' && result.payload) {
      setClientSearch(result.payload)
    } else if (result.page === 'estoque' && result.payload) {
      setStockSearch(result.payload)
    }
  }

  const addSaleItemRow = () => {
    if (!stockItems.length) return
    const product = stockItems[0]
    setSaleForm((prev) => ({
      ...prev,
      items: [...prev.items, { productId: product.id, quantity: 1, unitPrice: product.price, discount: 0 }],
    }))
  }

  const updateSaleItemRow = (index: number, updates: Partial<SaleItem>) => {
    setSaleForm((prev) => ({
      ...prev,
      items: prev.items.map((item, idx) => {
        if (idx !== index) return item
        const next = { ...item, ...updates }
        if (next.discount > next.unitPrice) {
          next.discount = next.unitPrice
        }
        if (next.discount < 0) next.discount = 0
        if (next.unitPrice < 0) next.unitPrice = 0
        return next
      }),
    }))
  }

  const removeSaleItemRow = (index: number) => {
    setSaleForm((prev) => {
      if (prev.items.length <= 1) return prev
      const nextItems = prev.items.filter((_, idx) => idx !== index)
      return { ...prev, items: nextItems }
    })
  }

  const addPaymentRow = () => {
    setSaleForm((prev) => ({
      ...prev,
      payments: [
        ...prev.payments,
        { id: `pay-${Date.now()}`, method: 'PIX', amount: 0, installments: 1 },
      ],
    }))
  }

  const updatePaymentRow = (index: number, updates: Partial<SalePayment>) => {
    setSaleForm((prev) => ({
      ...prev,
      payments: prev.payments.map((payment, idx) => {
        if (idx !== index) return payment
        const next = { ...payment, ...updates }
        if (next.amount < 0) next.amount = 0
        if (next.method !== 'Cartão de crédito') {
          next.installments = 1
        } else if (next.installments < 1) {
          next.installments = 1
        }
        return next
      }),
    }))
  }

  const removePaymentRow = (index: number) => {
    setSaleForm((prev) => {
      if (prev.payments.length <= 1) return prev
      const filtered = prev.payments.filter((_, idx) => idx !== index)
      return { ...prev, payments: filtered }
    })
  }

  const handleDeleteProduct = async (productId: string) => {
    if (!canManageStock || !authToken) return
    if (!productId) return
    const product = stockItems.find((item) => item.id === productId)
    if (!product) return
    if (product.quantity > 0 || product.reserved > 0) {
      window.alert('Só é possível remover produtos com estoque zerado.')
      return
    }
    try {
      const response = await fetch(`${API_BASE_URL}/stock/${productId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível remover o produto.')
      }
      setStockItems((prev) => {
        const updated = prev.filter((item) => item.id !== productId)
        const fallbackId = updated[0]?.id ?? ''
        setSaleForm((salePrev) => {
          const filteredItems: SaleItem[] = salePrev.items.filter((item) => item.productId !== productId)
          const fallbackProduct = updated.find((item) => item.id === fallbackId)
          const newItems = filteredItems.length
            ? filteredItems
            : fallbackId && fallbackProduct
              ? [{ productId: fallbackId, quantity: 1, unitPrice: fallbackProduct.price, discount: 0 }]
              : []
          return { ...salePrev, items: newItems }
        })
        setInventoryForm((prevForm) => {
          if (prevForm.isNewProduct) return prevForm
          if (prevForm.productId === productId) {
            return { ...prevForm, productId: fallbackId }
          }
          return prevForm
        })
        return updated
      })
      await fetchStockMovementsFromApi()
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : 'Erro ao remover produto.')
    }
  }
  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      })
      if (!response.ok) {
        throw new Error('Credenciais inválidas. Confira e tente novamente.')
      }
      const data = await response.json()
      const normalizedUser: User = {
        id: data.user.id,
        name: data.user.name ?? 'Usuário',
        email: data.user.email,
        role: data.user.role,
        phone: data.user.phone ?? '',
        password: '',
        active: data.user.active ?? true,
      }
      setUsers((prev) => {
        const exists = prev.some((user) => user.id === normalizedUser.id)
        if (exists) {
          return prev.map((user) => (user.id === normalizedUser.id ? normalizedUser : user))
        }
        return [...prev, normalizedUser]
      })
      setSessionUserId(normalizedUser.id)
      localStorage.setItem('auth_token', data.token)
      setAuthToken(data.token)
      setLoginEmail('')
      setLoginPassword('')
      setLoginError(null)
    } catch (error) {
      console.error(error)
      setLoginError(error instanceof Error ? error.message : 'Não foi possível entrar. Tente novamente.')
    }
  }

  const handleLogout = () => {
    setSessionUserId(null)
    setProfileModalOpen(false)
    localStorage.removeItem('auth_token')
    setAuthToken(null)
  }

  const closeClientModal = () => {
    setClientModalOpen(false)
    setClientModalClientId(null)
    setClientModalForm(emptyClientForm)
    setClientModalError(null)
    setClientModalLoading(false)
  }

  const openSaleModal = () => {
    if (!canRegisterSales) return
    setSaleDraftId(generateSaleId())
    setSaleForm(createSaleFormState(clients))
     setSaleModalError(null)
     setSaleModalLoading(false)
    setSaleModalOpen(true)
  }
  const closeSaleModal = () => {
    setSaleModalOpen(false)
    setSaleModalError(null)
    setSaleModalLoading(false)
  }

  const openCreateClientModal = () => {
    if (!canRegisterClients) return
    setClientModalMode('create')
    setClientModalClientId(null)
    setClientModalForm(emptyClientForm)
    setClientModalError(null)
    setClientModalOpen(true)
  }

  const openEditClientModal = (client: Client) => {
    if (!canEditClients) return
    setClientModalMode('edit')
    setClientModalClientId(client.id)
    setClientModalForm({
      name: client.name,
      phone: client.phone,
      cpf: client.cpf,
      addressStreet: client.addressStreet,
      addressNumber: client.addressNumber,
      addressNeighborhood: client.addressNeighborhood,
      addressCity: client.addressCity,
      addressNote: client.addressNote,
    })
    setClientModalError(null)
    setClientModalOpen(true)
  }

  const handleClientModalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setClientModalError(null)
    setClientModalLoading(true)
    try {
      if (clientModalMode === 'create') {
        await addClient(clientModalForm)
      } else if (clientModalClientId && canEditClients) {
        await updateClientRecord(clientModalClientId, clientModalForm)
      }
      closeClientModal()
    } catch (error) {
      console.error(error)
      setClientModalError(
        error instanceof Error ? error.message : 'Não foi possível salvar o cliente. Tente novamente.',
      )
    } finally {
      setClientModalLoading(false)
    }
  }

  const handleDeleteClient = async (clientId: string) => {
    if (!canDeleteClients) return
    setClientModalError(null)
    setClientModalLoading(true)
    try {
      await deleteClientRecord(clientId)
      if (clientModalClientId === clientId) {
        setClientModalOpen(false)
        setClientModalClientId(null)
      }
    } catch (error) {
      console.error(error)
      const message = error instanceof Error ? error.message : 'Não foi possível remover o cliente.'
      if (clientModalOpen) {
        setClientModalError(message)
      } else {
        window.alert(message)
      }
    } finally {
      setClientModalLoading(false)
    }
  }

  const handleRegisterSale = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaleModalError(null)
    if (!authToken) {
      setSaleModalError('Sessão expirada. Faça login novamente.')
      return
    }
    if (!saleForm.items.length) {
      setSaleModalError('Adicione pelo menos um produto ao pedido.')
      return
    }
    const clientExists = clients.some((client) => client.id === saleForm.clientId)
    if (!clientExists) {
      setSaleModalError('Cliente inválido.')
      return
    }
    if (!paymentBalanced) {
      setSaleModalError('Os pagamentos não conferem com o total do pedido.')
      return
    }
    if (saleForm.payments.some((payment) => payment.amount <= 0)) {
      setSaleModalError('Informe os valores de cada pagamento.')
      return
    }

    const quantityCheck: Record<string, number> = {}
    const saleItems: SaleItem[] = []
    for (const item of saleForm.items) {
      if (!item.productId || item.quantity <= 0) {
        setSaleModalError('Itens inválidos. Verifique as quantidades.')
        return
      }
      const product = stockItems.find((stockItem) => stockItem.id === item.productId)
      if (!product) {
        setSaleModalError('Produto inválido. Atualize o estoque antes de vender.')
        return
      }
      saleItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
      })
      quantityCheck[item.productId] = (quantityCheck[item.productId] ?? 0) + item.quantity
    }

    for (const [productId, qty] of Object.entries(quantityCheck)) {
      const product = stockItems.find((stockItem) => stockItem.id === productId)
      if (!product || product.quantity < qty) {
        setSaleModalError('Estoque insuficiente para concluir o pedido.')
        return
      }
    }

    const payload = {
      clientId: saleForm.clientId,
      items: saleItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
      })),
      payments: saleForm.payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        installments: payment.installments,
      })),
      note: saleForm.note.trim(),
      discount: normalizedDiscount,
      deliveryDate: saleForm.deliveryDate ? new Date(saleForm.deliveryDate).toISOString() : undefined,
    }

    setSaleModalLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/sales`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error('Não foi possível registrar a venda.')
      }
      const createdSale = normalizeSale(await response.json())
      setSales((prev) => [createdSale, ...prev])
      setStockItems((prev) =>
        prev.map((item) => {
          const qty = quantityCheck[item.id]
          if (!qty) return item
          return { ...item, quantity: item.quantity - qty, reserved: item.reserved + qty }
        }),
      )
      await fetchStockFromApi()
      await fetchStockMovementsFromApi()
      setSaleForm(createSaleFormState(clients))
      setSaleDraftId(generateSaleId())
      closeSaleModal()
      setLastReceiptId(createdSale.id)
    } catch (error) {
      console.error(error)
      setSaleModalError(error instanceof Error ? error.message : 'Erro ao registrar a venda.')
    } finally {
      setSaleModalLoading(false)
    }
  }

  const handleMarkDelivered = async (saleId: string) => {
    const sale = sales.find((item) => item.id === saleId)
    if (!sale) return
    if (!authToken) {
      window.alert('Sessão expirada. Faça login novamente.')
      return
    }
    const backendId = sale.backendId ?? saleId
    try {
      const response = await fetch(`${API_BASE_URL}/sales/${backendId}/confirm-delivery`, {
        method: 'POST',
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível confirmar a entrega.')
      }
      const updatedSale = normalizeSale(await response.json())
      setSales((prev) => prev.map((item) => (item.id === saleId ? updatedSale : item)))
      setStockItems((prev) =>
        prev.map((item) => {
          const reservedQty = sale.items
            .filter((saleItem) => saleItem.productId === item.id)
            .reduce((sum, saleItem) => sum + saleItem.quantity, 0)
          if (!reservedQty) return item
          return { ...item, reserved: Math.max(0, item.reserved - reservedQty) }
        }),
      )
      await fetchStockFromApi()
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : 'Erro ao confirmar entrega.')
    }
  }

  const handleInventoryMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canManageStock) return
    if (!authToken) {
      setInventorySubmitError('Sessão expirada. Faça login novamente.')
      return
    }
    const amount = Number(inventoryForm.amount)
    if (!amount || amount <= 0) {
      setInventorySubmitError('Informe a quantidade do movimento.')
      return
    }
    setInventorySubmitError(null)
    setInventorySubmitLoading(true)
    try {
      if (inventoryForm.isNewProduct) {
        if (inventoryForm.type !== 'entrada') {
          throw new Error('Cadastrar novos produtos está disponível apenas para entradas.')
        }
        const name = inventoryForm.newProductName.trim()
        if (!name) throw new Error('Informe o nome do produto.')
        const skuFromForm = inventoryForm.newProductSku.trim()
        const skuFallback = skuFromForm || `SKU-${Math.floor(Math.random() * 90000 + 10000)}`
        const priceNumber = Number(inventoryForm.newProductPrice)
        const payload = {
          name,
          sku: skuFallback,
          price: Number.isNaN(priceNumber) ? 0 : Math.max(0, priceNumber),
          quantity: amount,
          imageUrl: inventoryForm.newProductImage || undefined,
        }
        const response = await fetch(`${API_BASE_URL}/stock`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          throw new Error('Não foi possível cadastrar o produto.')
        }
        const createdProduct = normalizeStockItem(await response.json())
        setStockItems((prev) => [createdProduct, ...prev])
        await fetchStockFromApi()
        await fetchStockMovementsFromApi()
        resetInventoryForm(createdProduct.id)
      } else {
        if (!inventoryForm.productId) {
          throw new Error('Selecione um produto para movimentar.')
        }
        const product = stockItems.find((item) => item.id === inventoryForm.productId)
        if (!product) {
          throw new Error('Produto inválido.')
        }
        if (inventoryForm.type === 'saida' && product.quantity < amount) {
          throw new Error('Quantidade insuficiente em estoque para saída.')
        }
        const response = await fetch(`${API_BASE_URL}/stock/${inventoryForm.productId}/movements`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            type: inventoryForm.type,
            amount,
            note: inventoryForm.note.trim() || undefined,
          }),
        })
        if (!response.ok) {
          throw new Error('Não foi possível registrar o movimento.')
        }
        await fetchStockFromApi()
        await fetchStockMovementsFromApi()
        resetInventoryForm(inventoryForm.productId)
      }
      setInventoryPanelOpen(false)
    } catch (error) {
      console.error(error)
      setInventorySubmitError(error instanceof Error ? error.message : 'Erro ao registrar movimento.')
    } finally {
      setInventorySubmitLoading(false)
    }
  }

  const handleAssistancePhotoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files?.length) return
    const allowed = Math.max(0, MAX_ASSISTANCE_PHOTOS - assistanceForm.photos.length)
    if (allowed === 0) {
      event.target.value = ''
      return
    }
    Array.from(files)
      .slice(0, allowed)
      .forEach((file) => {
        const reader = new FileReader()
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            setAssistanceForm((prev) => ({ ...prev, photos: [...prev.photos, reader.result as string] }))
          }
        }
        reader.readAsDataURL(file)
      })
    event.target.value = ''
  }

  const handleRemoveAssistancePhoto = (index: number) => {
    setAssistanceForm((prev) => ({
      ...prev,
      photos: prev.photos.filter((_, photoIndex) => photoIndex !== index),
    }))
  }

  const handleSaveMonthlyGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAdmin) return
    setMonthlyGoalSaving(true)
    setMonthlyGoalNotice(null)
    setMonthlyGoalError(null)
    try {
      const response = await fetch(`${API_BASE_URL}/finance/goal`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ target: monthlyGoalFormValue }),
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        throw new Error(errorBody?.message ?? 'Não foi possível atualizar a meta.')
      }
      await fetchMonthlyGoalFromApi()
      setMonthlyGoalNotice('Meta atualizada com sucesso.')
    } catch (error) {
      console.error(error)
      setMonthlyGoalError(error instanceof Error ? error.message : 'Erro ao atualizar meta.')
    } finally {
      setMonthlyGoalSaving(false)
    }
  }

  const handleRegisterAssistance = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAdmin) {
      setAssistanceSubmitError('Apenas administradores podem registrar assistências.')
      return
    }
    if (!assistanceForm.saleId || !assistanceForm.productId || !assistanceForm.defectDescription.trim()) {
      setAssistanceSubmitError('Selecione venda, produto e descreva o defeito.')
      return
    }
    if (assistanceForm.defectDescription.trim().length < 5) {
      setAssistanceSubmitError('Descreva o defeito com pelo menos 5 caracteres.')
      return
    }
    const selectedSale = sales.find((sale) => (sale.backendId ?? sale.id) === assistanceForm.saleId)
    const productExists = stockItems.some((item) => item.id === assistanceForm.productId)
    if (!selectedSale || !productExists) return
    setAssistanceSubmitLoading(true)
    setAssistanceSubmitError(null)
    try {
      const payload = {
        saleId: selectedSale.backendId ?? selectedSale.id,
        productId: assistanceForm.productId,
        defectDescription: assistanceForm.defectDescription.trim(),
        factoryResponse: assistanceForm.factoryResponse.trim() || undefined,
        expectedDate: assistanceForm.expectedDate ? new Date(assistanceForm.expectedDate).toISOString() : undefined,
        photos: assistanceForm.photos.length > 0 ? assistanceForm.photos : undefined,
      }
      const response = await fetch(`${API_BASE_URL}/assistances`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        throw new Error(errorBody?.message ?? 'Não foi possível registrar a assistência.')
      }
      const data = await response.json()
      const normalized = normalizeAssistance(data)
      setAssistances((prev) => [normalized, ...prev.filter((item) => item.id !== normalized.id)])
      setAssistanceForm(createAssistanceFormState(sales))
    } catch (error) {
      console.error(error)
      setAssistanceSubmitError(error instanceof Error ? error.message : 'Erro ao registrar assistência.')
    } finally {
      setAssistanceSubmitLoading(false)
    }
  }

  const handleCompleteAssistance = async (assistanceId: string) => {
    if (!assistanceId || !isAdmin) return
    setAssistanceStatusLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/assistances/${assistanceId}/status`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: 'concluida' }),
      })
      if (!response.ok) {
        throw new Error('Não foi possível atualizar a assistência.')
      }
      const data = await response.json()
      const normalized = normalizeAssistance(data)
      setAssistances((prev) => prev.map((item) => (item.id === normalized.id ? normalized : item)))
      setAssistanceConfirm(null)
    } catch (error) {
      console.error(error)
      setAssistancesError(error instanceof Error ? error.message : 'Falha ao atualizar assistência.')
    } finally {
      setAssistanceStatusLoading(false)
    }
  }

  const handleAddUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isAdmin) return
    if (!userForm.name.trim() || !userForm.email.trim()) {
      setUserActionError('Preencha nome e e-mail do usuário.')
      return
    }
    setUserActionLoading(true)
    setUserActionError(null)
    setUserInviteTempPassword(null)
    setUserManagerNotice(null)
    try {
      const response = await fetch(`${API_BASE_URL}/auth/invite`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: userForm.name.trim(),
          email: userForm.email.trim(),
          phone: userForm.phone ? formatDigits(userForm.phone) : undefined,
          role: userForm.role,
        }),
      })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        throw new Error(errorBody?.message ?? 'Não foi possível criar o usuário.')
      }
      const data = await response.json()
      const normalized = normalizeUserFromApi(data.user)
      setUsers((prev) => [normalized, ...prev.filter((user) => user.id !== normalized.id)])
      setUserForm({ name: '', email: '', phone: '', role: 'seller' })
      setUserInviteTempPassword(data.tempPassword)
      setUserManagerNotice(`Usuário ${normalized.name} criado com sucesso.`)
    } catch (error) {
      console.error(error)
      setUserActionError(error instanceof Error ? error.message : 'Erro ao criar usuário.')
    } finally {
      setUserActionLoading(false)
    }
  }

  const handleDeleteUserAccount = async (userId: string) => {
    if (!isAdmin) return
    const target = users.find((user) => user.id === userId)
    if (!target || target.role === 'admin') return
    setUserActionLoading(true)
    setUserActionError(null)
    setUserManagerNotice(null)
    try {
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(false),
      })
      if (!response.ok) {
        throw new Error('Não foi possível remover o usuário.')
      }
      setUsers((prev) => prev.filter((user) => user.id !== userId))
      if (sessionUserId === userId) {
        setSessionUserId(null)
        localStorage.removeItem('auth_token')
        setAuthToken(null)
      }
      setUserManagerNotice(`Usuário ${target.name} removido.`)
    } catch (error) {
      console.error(error)
      setUserActionError(error instanceof Error ? error.message : 'Erro ao remover usuário.')
    } finally {
      setUserActionLoading(false)
    }
  }

  const handleResetUserPassword = async (userId: string) => {
    if (!isAdmin) return
    setUserActionLoading(true)
    setUserActionError(null)
    setUserInviteTempPassword(null)
    setUserManagerNotice(null)
    try {
      const response = await fetch(`${API_BASE_URL}/users/${userId}/reset-password`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({}),
      })
      if (!response.ok) {
        throw new Error('Não foi possível redefinir a senha.')
      }
      const data = await response.json()
      setUserInviteTempPassword(data.temporaryPassword)
      const target = users.find((user) => user.id === userId)
      setUserManagerNotice(
        target
          ? `Nova senha temporária para ${target.name}: ${data.temporaryPassword}`
          : 'Senha redefinida.',
      )
    } catch (error) {
      console.error(error)
      setUserActionError(error instanceof Error ? error.message : 'Erro ao redefinir senha.')
    } finally {
      setUserActionLoading(false)
    }
  }

  const handleToggleUserActive = async (userId: string) => {
    if (!isAdmin) return
    const target = users.find((user) => user.id === userId)
    if (!target) return
    setUserActionLoading(true)
    setUserActionError(null)
    setUserManagerNotice(null)
    try {
      const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ active: !target.active }),
      })
      if (!response.ok) {
        throw new Error('Não foi possível atualizar o usuário.')
      }
      const updated = normalizeUserFromApi(await response.json())
      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)))
      if (updated.id === sessionUserId && !updated.active) {
        setSessionUserId(null)
        localStorage.removeItem('auth_token')
        setAuthToken(null)
      }
    } catch (error) {
      console.error(error)
      setUserActionError(error instanceof Error ? error.message : 'Erro ao atualizar usuário.')
    } finally {
      setUserActionLoading(false)
    }
  }

  const renderDashboard = () => {
    const spotlightSales = sales.slice(0, 3)
    const nextDeliveries = sales
      .filter((sale) => sale.status === 'pendente')
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
      .slice(0, 3)
    const nowDate = new Date()
    const currentMonth = nowDate.getMonth()
    const currentYear = nowDate.getFullYear()
    const monthlySales = sales.filter((sale) => {
      const saleDate = new Date(sale.createdAt)
      return saleDate.getMonth() === currentMonth && saleDate.getFullYear() === currentYear
    })
    const monthlyRevenue = monthlySales.reduce((sum, sale) => sum + sale.value, 0)
    const monthlyOrders = monthlySales.length
    const averageTicket = monthlyOrders ? monthlyRevenue / monthlyOrders : 0
    const conversionRate = monthlyOrders
      ? Math.round(
          (monthlySales.filter((sale) => sale.status === 'entregue').length / monthlyOrders) * 100,
        )
      : null
    const pendingOrders = sales.filter((sale) => sale.status === 'pendente').length
    const deliveredOrders = sales.filter((sale) => sale.status === 'entregue').length
    const clientsWithSales = new Set(sales.map((sale) => sale.clientId)).size
    const reservedStock = stockItems.reduce((sum, item) => sum + item.reserved, 0)
    const totalStockUnits = stockItems.reduce((sum, item) => sum + item.quantity + item.reserved, 0)
    const dashboardMetrics = [
      {
        label: 'Receita do mês',
        value: formatCurrency(monthlyRevenue),
        note: monthlyOrders ? `${monthlyOrders} pedidos emitidos` : 'Cadastre sua primeira venda',
      },
      {
        label: 'Ticket médio',
        value: formatCurrency(averageTicket || 0),
        note: monthlyOrders ? `Base em ${monthlyOrders} pedidos` : 'Sem pedidos no mês atual',
      },
      {
        label: 'Pedidos pendentes',
        value: pendingOrders.toString(),
        note: 'Aguardando confirmação de entrega',
      },
      {
        label: 'Clientes com compras',
        value: clientsWithSales.toString(),
        note: `${clients.length} clientes ativos no CRM`,
      },
    ]
    const pipelineStages = [
      {
        name: 'Pendentes',
        primary: pendingOrders,
        detail: 'Vendas aguardando entrega',
        percent: sales.length ? Math.round((pendingOrders / sales.length) * 100) : 0,
      },
      {
        name: 'Entregues',
        primary: deliveredOrders,
        detail: 'Pedidos finalizados',
        percent: sales.length ? Math.round((deliveredOrders / sales.length) * 100) : 0,
      },
      {
        name: 'Reservas de estoque',
        primary: reservedStock,
        detail: 'Itens comprometidos para pedidos',
        percent: totalStockUnits ? Math.round((reservedStock / totalStockUnits) * 100) : 0,
      },
    ]
    const insightMessages: string[] = []
    if (!sales.length) {
      insightMessages.push('Cadastre sua primeira venda para liberar indicadores financeiros.')
    }
    if (pendingOrders) {
      insightMessages.push(`Há ${pendingOrders} pedidos aguardando confirmação de entrega.`)
    }
    const lowStock = stockItems.filter((item) => item.quantity <= 3).length
    if (lowStock) {
      insightMessages.push(`${lowStock} produtos estão em nível crítico de estoque.`)
    }
    if (!insightMessages.length) {
      insightMessages.push('Sem pendências no momento. Continue acompanhando o painel.')
    }

    const goalTarget = monthlyGoal?.target ?? 0
    const goalProgress = monthlyGoal?.progress ?? monthlyRevenue
    const goalPercent =
      goalTarget > 0 ? Math.min(100, Math.round((goalProgress / goalTarget) * 100)) : 0
    const goalMonthLabel = new Date(currentYear, currentMonth).toLocaleDateString('pt-BR', {
      month: 'long',
    })

    return (
      <div className={`dashboard-grid${searchFocused ? ' search-mode' : ''}`}>
        <div className={`global-search${searchFocused ? ' active' : ''}`}>
          <div className="global-search-input">
            <input
              placeholder="Pesquisar clientes, produtos, vendas e movimentos"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => {
                if (!globalSearch) setSearchFocused(false)
              }}
            />
          </div>
          {globalSearch && (
            <div className="global-search-results">
              {searchResults.length === 0 && <p className="empty-state">Nenhum resultado encontrado.</p>}
              {searchResults.map((result) => (
                <button type="button" key={result.id} onClick={() => handleSearchNavigate(result)}>
                  <span className="result-type">{result.type}</span>
                  <div>
                    <p className="result-title">{result.title}</p>
                    <p className="result-description">{result.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {searchFocused && (
            <div className="search-backdrop" onClick={() => { setSearchFocused(false); setGlobalSearch(''); }} />
          )}
        </div>

        <section className="panel hero-banner">
          <div className="hero-banner-left">
            <p className="eyebrow">Visão estratégica</p>
            <h1>Experiência de venda guiada e moderna</h1>
            <p className="hero-sub">
              Priorize ações e acompanhe indicadores críticos da loja em um único lugar.
            </p>
            <div className="hero-actions">
              <button
                type="button"
                className="primary"
                onClick={openSaleModal}
                disabled={!canRegisterSales || !clients.length || !stockItems.length}
              >
                Abrir nova venda
              </button>
              <button type="button" className="ghost" onClick={openCreateClientModal}>
                Registrar cliente
              </button>
            </div>
            <div className="hero-highlight-row">
              {facts.map((fact) => (
                <div className="hero-highlight" key={fact.label}>
                  <p className="fact-label">{fact.label}</p>
                  <p className="fact-value">{fact.value}</p>
                  <p className="fact-detail">{fact.detail}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="hero-banner-right">
            <div className="glass-card">
              <p className="eyebrow">Entregas pendentes</p>
              <ul>
                {nextDeliveries.length === 0 && <li>Sem entregas pendentes.</li>}
                {nextDeliveries.map((delivery) => {
                  const client = clients.find((clientItem) => clientItem.id === delivery.clientId)
                  return (
                    <li key={delivery.id}>
                      <div>
                        <strong>{client?.name ?? 'Cliente'}</strong>
                        <span>{new Date(delivery.deliveryDate).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <p>{delivery.items.map((item) => stockItems.find((stock) => stock.id === item.productId)?.name).join(', ')}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
            <div className="glass-card secondary">
              <p className="eyebrow">Índice de conversão</p>
              <h3>{conversionRate !== null ? `${conversionRate}%` : '—'}</h3>
              <p className="mini-note">
                {conversionRate !== null
                  ? 'Percentual de pedidos entregues em relação aos emitidos neste mês.'
                  : 'Nenhuma venda registrada no período atual.'}
              </p>
            </div>
          </div>
        </section>

        <section className="panel goal-panel">
          <div className="goal-progress">
            <div className="section-head goal-head">
              <div>
                <p className="eyebrow">Meta do mês</p>
                <h2>
                  {goalMonthLabel.charAt(0).toUpperCase() + goalMonthLabel.slice(1)} · {currentYear}
                </h2>
              </div>
              {monthlyGoalLoading && <span className="chip ghost">Atualizando…</span>}
            </div>
            {monthlyGoalError && <p className="login-error">{monthlyGoalError}</p>}
            <p className="goal-values">
              {formatCurrency(goalProgress)} de {goalTarget ? formatCurrency(goalTarget) : 'R$ 0,00'}
            </p>
            <div className="goal-bar">
              <span style={{ width: `${goalPercent}%` }} />
            </div>
            <p className="goal-percent">
              {goalTarget > 0 ? `${goalPercent}% atingido` : 'Defina a meta para este mês.'}
            </p>
          </div>
          {isAdmin && (
            <form className="goal-form" onSubmit={handleSaveMonthlyGoal}>
              <label>
                Meta mensal (R$)
                <NumericFormat
                  value={monthlyGoalFormValue === 0 ? '' : monthlyGoalFormValue}
                  thousandSeparator="."
                  decimalSeparator=","
                  decimalScale={2}
                  fixedDecimalScale
                  allowNegative={false}
                  inputMode="decimal"
                  placeholder="0,00"
                  onValueChange={({ floatValue }) => setMonthlyGoalFormValue(floatValue ?? 0)}
                />
              </label>
              <div className="goal-form-actions">
                <button className="primary" type="submit" disabled={monthlyGoalSaving}>
                  {monthlyGoalSaving ? 'Salvando...' : 'Salvar meta'}
                </button>
                {monthlyGoalNotice && <p className="user-notice">{monthlyGoalNotice}</p>}
              </div>
            </form>
          )}
        </section>

        <section className="panel deep-metrics span-2">
          <div className="metrics-grid">
            {dashboardMetrics.map((item) => (
              <div className="metric-card" key={item.label}>
                <div className="metric-top">
                  <p className="metric-label">{item.label}</p>
                </div>
                <p className="metric-value">{item.value}</p>
                <p className="metric-note">{item.note}</p>
              </div>
            ))}
          </div>
          <div className="pipeline-modern">
            <header>
              <div>
                <p className="eyebrow">Pipeline</p>
                <h2>Fluxo de oportunidades</h2>
              </div>
              <span className="chip ghost">Baseado nas vendas registradas</span>
            </header>
            <div className="pipeline-columns">
              {pipelineStages.map((stage) => (
                <div className="pipeline-column" key={stage.name}>
                  <div className="pipeline-column-head">
                    <p>{stage.name}</p>
                    <span>{stage.primary}</span>
                  </div>
                  <p className="stage-vibe">{stage.detail}</p>
                  <div className="stage-progress">
                    <span style={{ width: `${Math.min(100, stage.percent)}%` }} />
                  </div>
                  <div className="stage-foot">
                    <strong>{stage.percent}%</strong>
                    <span>do total observado</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel activity-grid">
          <div className="activity-column">
            <header>
              <p className="eyebrow">Vendas recentes</p>
              <h3>Spotlight</h3>
            </header>
            <ul>
              {spotlightSales.map((sale) => {
                const client = clients.find((clientItem) => clientItem.id === sale.clientId)
                return (
                  <li key={sale.id}>
                    <div>
                      <strong>#{sale.id}</strong>
                      <p>{client?.name ?? sale.clientName ?? 'Cliente removido'}</p>
                    </div>
                    <span>{formatCurrency(sale.value)}</span>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="activity-column secondary">
            <header>
              <p className="eyebrow">Insights rápidos</p>
              <h3>Próximas ações</h3>
            </header>
            <ul>
              {insightMessages.map((message, index) => (
                <li key={index}>{message}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    )
  }

  const renderLogin = () => (
    <div className="login-page">
      <div className="login-snowflakes">
        {Array.from({ length: 18 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="login-shell">
        <div className="login-hero-copy">
          <p className="eyebrow">Sonhar Conforto · Especial de Natal</p>
          <h1>Bem-vindo ao cockpit festivo da sua operação.</h1>
          <p>
            Monitore vendas, assistências e estoque celebrando a temporada: dashboards iluminados, dados protegidos e
            a tranquilidade que só um Natal organizado traz.
          </p>
          <div className="login-tree">
            <span className="tree-star">★</span>
            <span className="tree-layer layer-1" />
            <span className="tree-layer layer-2" />
            <span className="tree-layer layer-3" />
            <span className="tree-trunk" />
            <span className="tree-bauble red" />
            <span className="tree-bauble gold" />
            <span className="tree-bauble blue" />
          </div>
        </div>
        <div className="login-card">
          <div className="login-card-inner">
            <p className="eyebrow">Acesse sua conta</p>
            <h2>Entre para continuar</h2>
            <form className="login-form" onSubmit={handleLogin}>
              <label>
                E-mail corporativo
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  placeholder="nome@empresa.com"
                  required
                />
              </label>
              <label>
                Senha
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>
              {loginError && <p className="login-error">{loginError}</p>}
              <button className="primary full-width" type="submit">
                Entrar no CRM
              </button>
            </form>
            <p className="login-hint">Apenas administradores podem criar novos acessos por enquanto.</p>
          </div>
        </div>
      </div>
    </div>
  )

  const renderClients = () => {
    const clientCities = Array.from(
      new Set(clients.map((client) => client.addressCity || 'Sem cidade')),
    ).filter(Boolean)
    const purchasesByClient = sales.reduce<Record<string, number>>((acc, sale) => {
      acc[sale.clientId] = (acc[sale.clientId] ?? 0) + 1
      return acc
    }, {})
    const filteredClients = clients
      .filter((client) => {
        const term = clientSearch.toLowerCase().trim()
        if (!term) return true
        const haystack = [
          client.name ?? '',
          client.phone ?? '',
          client.cpf ?? '',
          client.addressCity ?? '',
          client.addressNeighborhood ?? '',
        ]
        return haystack.some((field) => field.toLowerCase().includes(term))
      })
      .filter((client) => {
        const purchases = purchasesByClient[client.id] ?? 0
        if (clientFilter === 'withSales') return purchases > 0
        if (clientFilter === 'withoutSales') return purchases === 0
        return true
      })
      .filter((client) => {
        const createdDate = client.createdAt.slice(0, 10)
        if (clientDateStart && createdDate < clientDateStart) return false
        if (clientDateEnd && createdDate > clientDateEnd) return false
        if (clientCityFilter !== 'all') {
          const city = client.addressCity || 'Sem cidade'
          return city === clientCityFilter
        }
        return true
      })

    return (
      <div className="page-stack">
        <section className="panel client-toolbar">
          <p className="eyebrow">Clientes</p>
          <h2>Pesquise e cadastre clientes</h2>
          <p className="hero-sub">Use a busca para encontrar rapidamente ou cadastre um novo cliente no botão.</p>
          <div className="client-search-bar">
            <input
              placeholder="Pesquisar por nome ou telefone"
              value={clientSearch}
              onChange={(event) => setClientSearch(event.target.value)}
            />
            <button className="primary" type="button" onClick={openCreateClientModal} disabled={!canRegisterClients}>
              Cadastrar cliente
            </button>
          </div>
          <div className="filter-pills">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'withSales', label: 'Com vendas' },
                { id: 'withoutSales', label: 'Sem vendas' },
              ] as const
            ).map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={clientFilter === filter.id ? 'active' : ''}
                onClick={() => setClientFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <label>
              Desde
              <input type="date" value={clientDateStart} onChange={(event) => setClientDateStart(event.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={clientDateEnd} onChange={(event) => setClientDateEnd(event.target.value)} />
            </label>
            <label>
              Cidade
              <select value={clientCityFilter} onChange={(event) => setClientCityFilter(event.target.value)}>
                <option value="all">Todas</option>
                {clientCities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Clientes</p>
              <h2>Lista ativa</h2>
            </div>
            <span className="chip ghost">{filteredClients.length} encontrados</span>
          </div>
          <div className="client-list">
            {clientsLoading && <p className="empty-state">Carregando clientes...</p>}
            {!clientsLoading && clientFetchError && <p className="empty-state">{clientFetchError}</p>}
            {!clientsLoading && !clientFetchError && filteredClients.length === 0 && (
              <p className="empty-state">Nenhum cliente encontrado com os filtros atuais.</p>
            )}
            {!clientsLoading && !clientFetchError && filteredClients.map((client) => {
              const purchases = purchasesByClient[client.id] ?? 0
              const initials = client.name
                .split(' ')
                .map((chunk) => chunk[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()
              const expanded = expandedClientId === client.id
              return (
                <div className={`client-card${expanded ? ' expanded' : ''}`} key={client.id}>
                  <button
                    type="button"
                    className="client-summary"
                    onClick={() => setExpandedClientId((prev) => (prev === client.id ? null : client.id))}
                  >
                    <div className="client-avatar">{initials}</div>
                    <div className="client-summary-text">
                      <p className="client-name">{client.name}</p>
                      <p className="client-summary-meta">
                        {client.phone || 'Sem contato'} · {purchases} vendas
                      </p>
                    </div>
                    <span className="client-summary-highlight">{client.addressCity || 'Cidade'}</span>
                    <span className={`client-chevron${expanded ? ' open' : ''}`} aria-hidden="true">
                      <svg viewBox="0 0 20 20" fill="none">
                        <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </span>
                  </button>
                  {expanded && (
                    <div className="client-details">
                      <div className="client-details-grid">
                        <div className="client-field">
                          <span className="field-label">Contato</span>
                          <p>{client.phone || 'Sem contato informado'}</p>
                          <p>{client.cpf || 'CPF não informado'}</p>
                        </div>
                        <div className="client-field">
                          <span className="field-label">Endereço</span>
                          <p>
                            {client.addressStreet || 'Rua não informada'}, {client.addressNumber || 's/n'}
                          </p>
                          <p>
                            {client.addressNeighborhood || 'Bairro'} · {client.addressCity || 'Cidade'}
                          </p>
                          {client.addressNote && <p className="field-note">{client.addressNote}</p>}
                        </div>
                      </div>
                      {canEditClients ? (
                        <div className="client-actions">
                          <button type="button" className="ghost" onClick={() => openEditClientModal(client)}>
                            Editar
                          </button>
                          <button type="button" className="ghost danger" onClick={() => handleDeleteClient(client.id)}>
                            Excluir
                          </button>
                        </div>
                      ) : (
                        <p className="field-note">Somente administradores podem editar ou excluir clientes.</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {filteredClients.length === 0 && <p className="empty-state">Nenhum cliente encontrado.</p>}
          </div>
        </section>
      </div>
    );
  };

  const renderReceiptSections = (sale: Sale) => {
    const receiptClient = clients.find((clientItem) => clientItem.id === sale.clientId)
    const saleItemsSnapshot = sale.items.map((item) => {
      const product = stockItems.find((stock) => stock.id === item.productId)
      return {
        ...item,
        productName: product?.name ?? 'Produto removido',
        sku: product?.sku ?? item.productId,
      }
    })
    const grossSubtotal = sale.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
    const paymentsTotal = sale.payments.reduce((sum, payment) => sum + payment.amount, 0)

    return ['1ª via • Loja', '2ª via • Cliente'].map((copyLabel, copyIndex) => (
      <section className="receipt-copy" data-copy={copyLabel} key={copyLabel}>
        <header className="receipt-copy-head">
          <div className="receipt-company">
            <p className="receipt-brand">SONHAR CONFORTO</p>
            <p>CRM do Sono · CNPJ 00.000.000/0001-00</p>
            <p>Av. dos Sonhos, 1234 · São Paulo – SP</p>
            <p>(11) 4002-8922 · contato@sonharconforto.com</p>
          </div>
          <div className="receipt-head-meta">
            <p>
              Pedido: <strong>{sale.id}</strong>
            </p>
            <p>Data: {new Date(sale.createdAt).toLocaleDateString('pt-BR')}</p>
            <p>
              Entrega prevista:{' '}
              {sale.deliveryDate ? new Date(sale.deliveryDate).toLocaleDateString('pt-BR') : '-'}
            </p>
            <span className="receipt-copy-label">{copyLabel}</span>
          </div>
        </header>
        <div className="receipt-block receipt-client">
          <div>
            <span className="field-label">Cliente</span>
            <p>{receiptClient?.name ?? receiptSale?.clientName ?? 'Cliente removido'}</p>
            <p>{receiptClient?.cpf || 'CPF não informado'}</p>
            <p>{receiptClient?.phone || 'Telefone não informado'}</p>
          </div>
          <div>
            <span className="field-label">Endereço</span>
            <p>
              {receiptClient?.addressStreet ?? 'Rua não informada'}, {receiptClient?.addressNumber ?? 's/n'}
            </p>
            <p>
              {receiptClient?.addressNeighborhood ?? 'Bairro'} · {receiptClient?.addressCity ?? 'Cidade'}
            </p>
            {receiptClient?.addressNote && <p className="field-note">{receiptClient.addressNote}</p>}
          </div>
        </div>
        <table className="receipt-table">
          <thead>
            <tr>
              <th style={{ width: '140px' }}>Código</th>
              <th>Descrição do produto</th>
              <th style={{ width: '60px' }}>Qtd</th>
              <th style={{ width: '120px' }}>Unitário</th>
              <th style={{ width: '120px' }}>Desconto</th>
              <th style={{ width: '140px' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {saleItemsSnapshot.map((item, index) => (
              <tr key={`${item.productId}-${index}`}>
                <td>{item.sku}</td>
                <td>{item.productName}</td>
                <td>{item.quantity}</td>
                <td>{formatCurrency(item.unitPrice)}</td>
                <td>-{item.discount ? formatCurrency(item.discount) : 'R$ 0,00'}</td>
                <td>{formatCurrency(item.quantity * (item.unitPrice - item.discount))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}></td>
              <td>Subtotal</td>
              <td>{formatCurrency(grossSubtotal)}</td>
            </tr>
            <tr>
              <td colSpan={4}></td>
              <td>Descontos</td>
              <td>-{formatCurrency(sale.discount)}</td>
            </tr>
            <tr>
              <td colSpan={4}></td>
              <td>Total pago</td>
              <td>{formatCurrency(sale.value)}</td>
            </tr>
          </tfoot>
        </table>
        <div className="receipt-block">
          <div>
            <span className="field-label">Pagamentos</span>
            {sale.payments.map((payment) => (
              <p key={payment.id}>
                {payment.method}
                {payment.method === 'Cartão de crédito' && payment.installments > 1
                  ? ` · ${payment.installments}x`
                  : ''}{' '}
                — {formatCurrency(payment.amount)}
              </p>
            ))}
            <p className="field-note">Recebido: {formatCurrency(paymentsTotal)}</p>
          </div>
          {sale.note && (
            <div>
              <span className="field-label">Observações</span>
              <p>{sale.note}</p>
            </div>
          )}
        </div>
        <div className="receipt-footer">
          <div>
            <p className="field-label">Assinatura da loja</p>
            <div className="receipt-signature" />
          </div>
          <div>
            <p className="field-label">Assinatura do cliente</p>
            <div className="receipt-signature" />
          </div>
        </div>
        <div className="receipt-terms">
          <p className="field-label">Termos</p>
          <p>
            Este comprovante deve acompanhar a mercadoria até a entrega. Conferir produtos no ato da entrega. Em caso de
            divergência entrar em contato em até 24h.
          </p>
        </div>
        {copyIndex === 0 && <div className="receipt-divider" />}
      </section>
    ))
  }

  const renderSleepLab = () => {
    const lastReceiptSale = lastReceiptId ? sales.find((sale) => sale.id === lastReceiptId) : null
    const normalizedSaleSearch = saleSearch.trim().toLowerCase()
    const saleMatchesSearch = (sale: Sale) => {
      if (!normalizedSaleSearch) return true
      const client = clients.find((clientItem) => clientItem.id === sale.clientId)
      const productNames = sale.items
        .map((item) => stockItems.find((stock) => stock.id === item.productId)?.name ?? item.productName ?? '')
        .join(' ')
        .toLowerCase()
      const blob = `${sale.id} ${client?.name ?? sale.clientName ?? ''} ${sale.note} ${productNames}`.toLowerCase()
      return blob.includes(normalizedSaleSearch)
    }
    const saleMatchesFilter = (sale: Sale) => saleFilter === 'all' || sale.status === saleFilter
    const saleMatchesDate = (sale: Sale) => {
      const createdDate = sale.createdAt.slice(0, 10)
      if (saleDateStart && createdDate < saleDateStart) return false
      if (saleDateEnd && createdDate > saleDateEnd) return false
      return true
    }
    const saleMatchesPayment = (sale: Sale) =>
      salePaymentFilter === 'all' ? true : sale.payments.some((payment) => payment.method === salePaymentFilter)
    const saleMinValueNumber = saleMinValue ? Number(saleMinValue) : null
    const saleMatchesValue = (sale: Sale) =>
      saleMinValueNumber === null || Number.isNaN(saleMinValueNumber) ? true : sale.value >= saleMinValueNumber
    const visibleSales = sales.filter(
      (sale) =>
        saleMatchesSearch(sale) &&
        saleMatchesFilter(sale) &&
        saleMatchesDate(sale) &&
        saleMatchesPayment(sale) &&
        saleMatchesValue(sale),
    )
    return (
      <div className="page-stack">
        {lastReceiptSale && (
          <div className="panel receipt-toast">
            <div>
              <p className="eyebrow">Nota pronta</p>
              <h3>Venda #{lastReceiptSale.id} registrada</h3>
              <p className="hero-sub">Clique em visualizar nota para gerar o PDF desta venda.</p>
            </div>
            <div className="receipt-toast-actions">
              <button className="ghost" type="button" onClick={() => setLastReceiptId(null)}>
                Dispensar
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  openReceiptModal(lastReceiptSale)
                  setLastReceiptId(null)
                }}
              >
                Visualizar nota
              </button>
            </div>
          </div>
        )}
        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Sleep Lab</p>
              <h2>Vendas recentes</h2>
            </div>
            <div className="quick-actions">
              <button
                className="ghost"
                type="button"
                onClick={openSaleModal}
                disabled={!canRegisterSales}
              >
                Registrar venda
              </button>
            </div>
          </div>
          <div className="sales-search">
            <input
              placeholder="Buscar por cliente, venda (#VEN) ou produto"
              value={saleSearch}
              onChange={(event) => setSaleSearch(event.target.value)}
            />
            <span className="chip ghost">{visibleSales.length} encontrados</span>
          </div>
          <div className="filter-pills">
            {(
              [
                { id: 'all', label: 'Todas' },
                { id: 'pendente', label: 'Pendentes' },
                { id: 'entregue', label: 'Entregues' },
              ] as const
            ).map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={saleFilter === filter.id ? 'active' : ''}
                onClick={() => setSaleFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="filter-row">
            <label>
              Desde
              <input type="date" value={saleDateStart} onChange={(event) => setSaleDateStart(event.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={saleDateEnd} onChange={(event) => setSaleDateEnd(event.target.value)} />
            </label>
            <label>
              Pagamento
              <select value={salePaymentFilter} onChange={(event) => setSalePaymentFilter(event.target.value as typeof salePaymentFilter)}>
                <option value="all">Todos</option>
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Valor mínimo (R$)
              <input
                type="number"
                min={0}
                step="0.01"
                value={saleMinValue}
                onChange={(event) => setSaleMinValue(event.target.value)}
              />
            </label>
          </div>
          <div className="sales-list">
            {salesLoading && <p className="empty-state">Carregando vendas...</p>}
            {!salesLoading && salesError && <p className="empty-state">{salesError}</p>}
            {!salesLoading && !salesError && visibleSales.length === 0 && (
              <p className="empty-state">Nenhuma venda encontrada com os filtros atuais.</p>
            )}
            {!salesLoading &&
              !salesError &&
              visibleSales.map((sale) => {
                const client = clients.find((clientItem) => clientItem.id === sale.clientId)
                const totalUnits = sale.items.reduce((sum, item) => sum + item.quantity, 0)
                return (
                  <div className={`sale-card ${sale.status}`} key={sale.id}>
                    <div>
                      <p className="sale-id">
                        #{sale.id} · {client?.name ?? sale.clientName ?? 'Cliente removido'}
                      </p>
                      <p className="sale-meta">
                        {totalUnits} itens · {formatCurrency(sale.value)}
                      </p>
                      {sale.deliveryDate && (
                        <p className="sale-meta mini">
                          Entrega prevista {new Date(sale.deliveryDate).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                      <div className="sale-items-list">
                        {sale.items.map((item, idx) => {
                          const productInfo = stockItems.find((stock) => stock.id === item.productId)
                          return (
                            <span key={`${item.productId}-${idx}`}>
                              {item.quantity}x {productInfo?.name ?? item.productName ?? 'Produto removido'} —{' '}
                              {formatCurrency(Math.max(0, item.unitPrice - item.discount))}
                              {item.discount > 0 && ` (desconto de ${formatCurrency(item.discount)}/u)`}
                            </span>
                          )
                        })}
                      </div>
                      <div className="sale-payments-list">
                        {sale.payments.map((payment) => (
                          <span key={payment.id}>
                            {payment.method}
                            {payment.method === 'Cartão de crédito' && payment.installments > 1
                              ? ` · ${payment.installments}x`
                              : ''}{' '}
                            — {formatCurrency(payment.amount)}
                          </span>
                        ))}
                      </div>
                      {sale.discount > 0 && (
                        <span className="chip ghost">Desconto aplicado · {formatCurrency(sale.discount)}</span>
                      )}
                      {sale.note && <p className="sale-note">Observação: {sale.note}</p>}
                      <p className="sale-note">
                        Criado em {new Date(sale.createdAt).toLocaleDateString('pt-BR')} ·{' '}
                        {sale.status === 'pendente' ? 'aguardando entrega' : 'entregue'}
                      </p>
                    </div>
                    <div className="sale-card-actions">
                      <button type="button" className="ghost" onClick={() => openReceiptModal(sale)}>
                        Visualizar nota
                      </button>
                      <button
                        type="button"
                        className={sale.status === 'pendente' ? 'primary subtle' : 'ghost'}
                        onClick={() =>
                          setConfirmDeliveryState({
                            sale,
                          })
                        }
                        disabled={sale.status === 'entregue'}
                      >
                        {sale.status === 'entregue' ? 'Entregue' : 'Confirmar entrega'}
                      </button>
                    </div>
                  </div>
                )
              })}
          </div>
        </section>

      </div>
    )
  }

  const renderDeliveries = () => {
    const deliveryMatchesFilter = (sale: Sale) => deliveryFilter === 'all' || sale.status === deliveryFilter
    const deliveriesByDate = sales
      .filter((sale) => sale.deliveryDate)
      .filter((sale) => deliveryMatchesFilter(sale))
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
      .reduce<Record<string, Sale[]>>((acc, sale) => {
        if (!sale.deliveryDate) return acc
        acc[sale.deliveryDate] = acc[sale.deliveryDate] ? [...acc[sale.deliveryDate], sale] : [sale]
        return acc
      }, {})

    return (
      <div className="page-stack">
        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Entregas</p>
              <h2>Agenda completa</h2>
            </div>
            <div className="calendar-nav">
              <button className="ghost" type="button" onClick={() => setDeliveryMonthOffset((prev) => Math.max(0, prev - 1))} disabled={deliveryMonthOffset === 0}>
                Mês anterior
              </button>
              <button className="ghost" type="button" onClick={() => setDeliveryMonthOffset((prev) => prev + 1)}>
                Próximo mês
              </button>
            </div>
          </div>
          <div className="filter-pills">
            {(
              [
                { id: 'all', label: 'Todas' },
                { id: 'pendente', label: 'Pendentes' },
                { id: 'entregue', label: 'Entregues' },
              ] as const
            ).map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={deliveryFilter === filter.id ? 'active' : ''}
                onClick={() => setDeliveryFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {salesLoading && <p className="empty-state">Carregando vendas...</p>}
          {!salesLoading && salesError && <p className="empty-state">{salesError}</p>}
          <div className="calendar-grid">
            {calendarRange.map((date) => {
              const deliveries = deliveriesByDate[date] ?? []
              return (
                <div className="calendar-day" key={date}>
                  <p className="day-label">
                    {new Date(date).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                  </p>
                  <div className="day-deliveries">
                    {deliveries.length === 0 && <p className="empty-state mini">Sem entregas.</p>}
                    {deliveries.map((sale) => {
                      const client = clients.find((clientItem) => clientItem.id === sale.clientId)
                      return (
                        <div className={`calendar-card ${sale.status}`} key={sale.id}>
                          <div>
                            <strong>{client?.name ?? sale.clientName ?? 'Cliente removido'}</strong>
                            <p className="sale-meta mini">
                              {sale.items
                                .map(
                                  (saleItem) =>
                                    stockItems.find((stock) => stock.id === saleItem.productId)?.name ??
                                    saleItem.productName ??
                                    '',
                                )
                                .filter(Boolean)
                                .join(', ')}
                            </p>
                          </div>
                          <button
                            type="button"
                            className={sale.status === 'pendente' ? 'primary subtle' : 'ghost'}
                            onClick={() =>
                              setConfirmDeliveryState({
                                sale,
                                redirect: 'sleepLab',
                              })
                            }
                            disabled={sale.status === 'entregue'}
                          >
                            {sale.status === 'pendente' ? 'Confirmar' : 'Entregue'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    )
  }

  const renderStock = () => {
    const stockMinValueNumber = stockMinValue ? Number(stockMinValue) : null
    const stockMaxValueNumber = stockMaxValue ? Number(stockMaxValue) : null
    const filteredStock = stockItems
      .filter((item) => {
        const term = stockSearch.toLowerCase().trim()
        if (!term) return true
        return item.name.toLowerCase().includes(term) || item.sku.toLowerCase().includes(term)
      })
      .filter((item) => {
        if (stockFilter === 'low') return item.quantity <= 3
        if (stockFilter === 'reserved') return item.reserved > 0
        return true
      })
      .filter((item) => {
        if (stockMinValueNumber !== null && !Number.isNaN(stockMinValueNumber) && item.price < stockMinValueNumber) {
          return false
        }
        if (stockMaxValueNumber !== null && !Number.isNaN(stockMaxValueNumber) && item.price > stockMaxValueNumber) {
          return false
        }
        return true
      })
    const totalAvailable = stockItems.reduce((sum, item) => sum + item.quantity, 0)
    const totalReserved = stockItems.reduce((sum, item) => sum + item.reserved, 0)
    const totalStockValue = stockItems.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const lowStock = stockItems.filter((item) => item.quantity <= 3).length
    const selectedInventoryProduct = stockItems.find((item) => item.id === inventoryForm.productId)
    const normalizedExplore = stockExploreTerm.trim().toLowerCase()
    const stockSearchResults = normalizedExplore
      ? [
          ...stockItems
            .filter((item) => `${item.name} ${item.sku}`.toLowerCase().includes(normalizedExplore))
            .map((item) => ({
              id: `prod-${item.id}`,
              type: 'Produto',
              title: item.name,
              subtitle: `SKU ${item.sku} · ${item.quantity} disponíveis`,
              action: () => focusInventoryPanel(item.id),
            })),
          ...stockMovements
            .filter((movement) => {
              const product = stockItems.find((item) => item.id === movement.productId)
              const blob = `${product?.name ?? ''} ${movement.note}`.toLowerCase()
              return blob.includes(normalizedExplore)
            })
            .map((movement) => {
              const product = stockItems.find((item) => item.id === movement.productId)
              return {
                id: movement.id,
                type: movement.type === 'entrada' ? 'Entrada' : 'Saída',
                title: product?.name ?? 'Produto removido',
                subtitle: `${movement.amount} unidades · ${new Date(movement.createdAt).toLocaleDateString('pt-BR')}`,
                action: () => setStockExploreTerm(''),
              }
            }),
        ]
      : []

    const filteredMovements = stockMovements
      .filter((movement) => (movementTypeFilter === 'all' ? true : movement.type === movementTypeFilter))
      .filter((movement) => {
        const movementDate = movement.createdAt.slice(0, 10)
        if (movementDateStart && movementDate < movementDateStart) return false
        if (movementDateEnd && movementDate > movementDateEnd) return false
        return true
      })

    return (
      <div className="page-stack stock-page">
        <section className="panel stock-explorer">
          <div className="section-head">
            <div>
              <p className="eyebrow">Estoque</p>
              <h2>Pesquisar no estoque</h2>
            </div>
          </div>
          <div className="stock-explorer-search">
            <input
              placeholder="Buscar por produto, SKU ou movimento"
              value={stockExploreTerm}
              onChange={(event) => setStockExploreTerm(event.target.value)}
            />
          </div>
          {stockExploreTerm.trim() ? (
            <div className="stock-explorer-results">
              {stockSearchResults.length === 0 && <p className="empty-state">Nada encontrado com esse termo.</p>}
              {stockSearchResults.map((result) => (
                <button type="button" key={result.id} onClick={result.action}>
                  <span className="result-type">{result.type}</span>
                  <div>
                    <p className="result-title">{result.title}</p>
                    <p className="result-description">{result.subtitle}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="field-note">Pesquise rapidamente por produtos, SKUs e movimentações recentes.</p>
          )}
        </section>

        <section className="panel stock-hero">
          <div className="stock-hero-top">
            <div>
              <p className="eyebrow">Estoque</p>
              <h2>Visão geral</h2>
              <p className="hero-sub">Capacidade, valor e status dos produtos da loja.</p>
            </div>
            <div className="stock-head-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => focusInventoryPanel()}
                disabled={!canManageStock}
                title={canManageStock ? 'Registrar entrada/saída' : 'Disponível apenas para administradores'}
              >
                Registrar movimento
              </button>
              <button type="button" className="ghost" onClick={openCreateClientModal}>
                Cadastrar cliente
              </button>
              <span className="chip ghost">{stockItems.length} SKUs</span>
            </div>
          </div>
          <div className="stock-highlight-grid">
            <div className="stock-highlight-card">
              <p>Itens disponíveis</p>
              <strong>{totalAvailable}</strong>
              <span>{totalReserved} reservados</span>
            </div>
            <div className="stock-highlight-card">
              <p>Valor em estoque</p>
              <strong>{formatCurrency(totalStockValue)}</strong>
              <span>{lowStock} itens com atenção</span>
            </div>
            <div className="stock-highlight-card">
              <p>Capacidade</p>
              <strong>{totalAvailable + totalReserved} unidades</strong>
              <span>{stockMovements.length} movimentos registrados</span>
            </div>
          </div>
          <div className="stock-search-row">
            <input
              placeholder="Buscar produto ou SKU"
              value={stockSearch}
              onChange={(event) => setStockSearch(event.target.value)}
            />
            <span className="chip ghost">{filteredStock.length} encontrados</span>
          </div>
          <div className="filter-row">
            <label>
              Valor mínimo (R$)
              <input
                type="number"
                min={0}
                step="0.01"
                value={stockMinValue}
                onChange={(event) => setStockMinValue(event.target.value)}
              />
            </label>
            <label>
              Valor máximo (R$)
              <input
                type="number"
                min={0}
                step="0.01"
                value={stockMaxValue}
                onChange={(event) => setStockMaxValue(event.target.value)}
              />
            </label>
          </div>
          <div className="filter-pills">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'low', label: 'Baixo estoque' },
                { id: 'reserved', label: 'Com reserva' },
              ] as const
            ).map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={stockFilter === filter.id ? 'active' : ''}
                onClick={() => setStockFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="stock-grid">
            {stockLoading && <p className="empty-state">Carregando produtos...</p>}
            {!stockLoading && stockError && <p className="empty-state">{stockError}</p>}
            {!stockLoading && !stockError && filteredStock.length === 0 && (
              <p className="empty-state">Nenhum produto encontrado.</p>
            )}
            {!stockLoading &&
              !stockError &&
              filteredStock.map((item) => {
              const totalUnits = item.quantity + item.reserved
              const reservedPercent = totalUnits ? Math.round((item.reserved / totalUnits) * 100) : 0
              const canRemove = item.quantity === 0 && item.reserved === 0
              const hasHistory = stockMovements.some((movement) => movement.productId === item.id)
              return (
                <div className="stock-card" key={item.id}>
                  <div className="stock-card-top">
                    <img src={item.imageUrl} alt={item.name} />
                    <div className="stock-card-info">
                      <p>{item.name}</p>
                      <span>{item.sku}</span>
                    </div>
                    <div className="stock-card-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => focusInventoryPanel(item.id)}
                        disabled={!canManageStock}
                        title={canManageStock ? 'Movimentar estoque' : 'Disponível apenas para administradores'}
                      >
                        Movimentar
                      </button>
                      <button
                        type="button"
                        className="ghost danger"
                        onClick={() => handleDeleteProduct(item.id)}
                        disabled={!canRemove || !canManageStock}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                  <div className="stock-card-stats">
                    <div>
                      <span>Disponível</span>
                      <strong>{item.quantity}</strong>
                    </div>
                    <div>
                      <span>Reservado</span>
                      <strong>{item.reserved}</strong>
                    </div>
                    <div>
                      <span>Valor unitário</span>
                      <strong>{formatCurrency(item.price)}</strong>
                    </div>
                  </div>
                  <div className="stock-card-bar">
                    <div className="meter">
                      <span style={{ width: `${reservedPercent}%` }} />
                    </div>
                    <small>{reservedPercent}% reservado</small>
                  </div>
                  <div className="stock-card-footer">
                    <div>
                      <span>Estoque estimado</span>
                      <strong>{formatCurrency(item.price * item.quantity)}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <p className="muted">{hasHistory ? 'Com movimentações recentes' : 'Sem movimentos'}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel stock-movement" ref={inventoryPanelRef}>
          <div className="section-head">
            <div>
              <p className="eyebrow">Estoque</p>
              <h2>Movimentar inventário</h2>
            </div>
            <button
              type="button"
              className={`primary ${inventoryPanelOpen ? 'subtle' : ''}`}
              onClick={() => canManageStock && setInventoryPanelOpen((prev) => !prev)}
              disabled={!canManageStock}
              title={canManageStock ? 'Abrir formulário' : 'Somente administradores podem movimentar estoque'}
            >
              {inventoryPanelOpen ? 'Fechar formulário' : 'Registrar movimento'}
            </button>
          </div>
          <p className="hero-sub">Selecione o tipo de movimento, o produto e confirme a quantidade.</p>
          <div className={`inventory-form-shell ${inventoryPanelOpen ? 'open' : ''}`}>
            {!canManageStock ? (
              <p className="empty-state">Somente administradores podem registrar entradas ou saídas.</p>
            ) : inventoryPanelOpen ? (
              <form className="stock-unified-card" onSubmit={handleInventoryMovement}>
                <div className="inventory-columns">
                  <div className="inventory-main">
                    <div className="inventory-form-head">
                      <p className="form-title">Tipo de movimento</p>
                      <div className="type-switch">
                        {(['entrada', 'saida'] as StockMovement['type'][]).map((type) => (
                          <button
                            key={type}
                            type="button"
                            className={inventoryForm.type === type ? 'active' : ''}
                            onClick={() =>
                              setInventoryForm((prev) => ({
                                ...prev,
                                type,
                                isNewProduct: type === 'entrada' ? prev.isNewProduct : false,
                              }))
                            }
                          >
                            {type === 'entrada' ? 'Entrada' : 'Saída'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className={`new-product-toggle ${inventoryForm.type !== 'entrada' ? 'disabled' : ''}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={inventoryForm.isNewProduct}
                          disabled={inventoryForm.type !== 'entrada'}
                          onChange={(event) =>
                            setInventoryForm((prev) => ({
                              ...prev,
                              isNewProduct: event.target.checked && prev.type === 'entrada',
                            }))
                          }
                        />
                        Cadastrar novo produto nesta entrada
                      </label>
                      <span>
                        {inventoryForm.type === 'entrada'
                          ? 'Informe os dados e a foto para incluir no catálogo.'
                          : 'Disponível apenas para movimentos de entrada.'}
                      </span>
                    </div>
                    <div className="inventory-grid">
                      {inventoryForm.isNewProduct ? (
                        <>
                          <label>
                            Nome do produto
                            <input
                              value={inventoryForm.newProductName}
                              onChange={(event) =>
                                setInventoryForm((prev) => ({ ...prev, newProductName: event.target.value }))
                              }
                              placeholder="Ex: Colchão Wave Supreme"
                            />
                          </label>
                          <label>
                            SKU
                            <input
                              value={inventoryForm.newProductSku}
                              onChange={(event) =>
                                setInventoryForm((prev) => ({ ...prev, newProductSku: event.target.value }))
                              }
                              placeholder="SKU interno"
                            />
                          </label>
                          <label>
                            Preço base (R$)
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={inventoryForm.newProductPrice}
                              onChange={(event) =>
                                setInventoryForm((prev) => ({ ...prev, newProductPrice: event.target.value }))
                              }
                              placeholder="8900"
                            />
                          </label>
                        </>
                      ) : (
                      <label>
                        Produto
                        <select
                          value={inventoryForm.productId}
                          onChange={(event) =>
                            setInventoryForm((prev) => ({ ...prev, productId: event.target.value }))
                          }
                        >
                          {!stockItems.length && <option value="">Nenhum produto cadastrado</option>}
                          {stockItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                          </select>
                        </label>
                      )}
                      <label>
                        Quantidade
                        <input
                          type="number"
                          min={1}
                          value={inventoryForm.amount}
                          onChange={(event) =>
                            setInventoryForm((prev) => ({ ...prev, amount: Number(event.target.value) }))
                          }
                        />
                      </label>
                    </div>
                    {inventoryForm.isNewProduct && (
                      <div className="inventory-grid">
                        <label className="file-field">
                          Foto do produto
                          <input type="file" accept="image/*" onChange={handleProductImageUpload} />
                        </label>
                        {inventoryForm.newProductImage && (
                          <div className="inventory-image-preview">
                            <img src={inventoryForm.newProductImage} alt="Prévia do produto" />
                            <button
                              type="button"
                              className="ghost"
                              onClick={() => setInventoryForm((prev) => ({ ...prev, newProductImage: '' }))}
                            >
                              Remover foto
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <label>
                      Observação
                      <input
                        value={inventoryForm.note}
                        onChange={(event) => setInventoryForm((prev) => ({ ...prev, note: event.target.value }))}
                        placeholder="Fornecedor, NF ou motivo"
                      />
                    </label>
                  </div>
                  <aside className="inventory-preview">
                    {inventoryForm.isNewProduct ? (
                      <div className="preview-card">
                        <p className="preview-label">Novo produto</p>
                        <h4>Cadastre e já dê entrada</h4>
                        <p>Preencha os campos ao lado e inclua uma foto para estrear o item no catálogo.</p>
                      </div>
                    ) : selectedInventoryProduct ? (
                      <div className="preview-card">
                        <img src={selectedInventoryProduct.imageUrl} alt={selectedInventoryProduct.name} />
                        <h4>{selectedInventoryProduct.name}</h4>
                        <p className="preview-sku">{selectedInventoryProduct.sku}</p>
                        <div className="preview-metrics">
                          <div>
                            <span>Disponível</span>
                            <strong>{selectedInventoryProduct.quantity}</strong>
                          </div>
                          <div>
                            <span>Reservado</span>
                            <strong>{selectedInventoryProduct.reserved}</strong>
                          </div>
                          <div>
                            <span>Valor</span>
                            <strong>{formatCurrency(selectedInventoryProduct.price)}</strong>
                          </div>
                        </div>
                        <p className="preview-note">
                          {selectedInventoryProduct.quantity > 0
                            ? 'Produto em linha. Registre saídas ou novas entradas.'
                            : 'Sem unidades disponíveis. Reponha o estoque.'}
                        </p>
                      </div>
                    ) : (
                      <div className="preview-card">
                        <h4>Sem produtos cadastrados</h4>
                        <p>Cadastre um novo item para começar a controlar o inventário.</p>
                      </div>
                    )}
                  </aside>
                </div>
                {inventorySubmitError && <p className="login-error">{inventorySubmitError}</p>}
                <div className="inventory-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setInventoryPanelOpen(false)}
                    disabled={inventorySubmitLoading}
                  >
                    Cancelar
                  </button>
                  <button
                    className="primary"
                    type="submit"
                    disabled={
                      inventorySubmitLoading ||
                      (!inventoryForm.isNewProduct && !inventoryForm.productId) ||
                      (!inventoryForm.isNewProduct && stockItems.length === 0)
                    }
                  >
                    {inventorySubmitLoading
                      ? 'Registrando...'
                      : inventoryForm.type === 'entrada'
                        ? 'Confirmar entrada'
                        : 'Confirmar saída'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                className="ghost full-width"
                type="button"
                onClick={() => canManageStock && setInventoryPanelOpen(true)}
                disabled={!canManageStock}
              >
                Abrir formulário de movimento
              </button>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Estoque</p>
              <h2>Histórico de movimentos</h2>
            </div>
            <span className="chip ghost">{filteredMovements.length} registros</span>
          </div>
          <div className="filter-row">
            <label>
              Tipo
              <select value={movementTypeFilter} onChange={(event) => setMovementTypeFilter(event.target.value as typeof movementTypeFilter)}>
                <option value="all">Todos</option>
                <option value="entrada">Entradas</option>
                <option value="saida">Saídas</option>
              </select>
            </label>
            <label>
              Desde
              <input
                type="date"
                value={movementDateStart}
                onChange={(event) => setMovementDateStart(event.target.value)}
              />
            </label>
            <label>
              Até
              <input
                type="date"
                value={movementDateEnd}
                onChange={(event) => setMovementDateEnd(event.target.value)}
              />
            </label>
          </div>
          <div className="sales-list">
            {stockMovementsLoading && <p className="empty-state">Carregando movimentos...</p>}
            {!stockMovementsLoading && stockMovementsError && <p className="empty-state">{stockMovementsError}</p>}
            {!stockMovementsLoading && !stockMovementsError && filteredMovements.length === 0 && (
              <p className="empty-state">Nenhum movimento registrado.</p>
            )}
            {!stockMovementsLoading &&
              !stockMovementsError &&
              filteredMovements.map((movement) => {
              const product = stockItems.find((item) => item.id === movement.productId)
              return (
                <div className={`movement-card ${movement.type}`} key={movement.id}>
                  <div>
                    <p className="sale-id">
                      {movement.type === 'entrada' ? 'Entrada' : 'Saída'} · {product?.name ?? 'Produto removido'}
                    </p>
                    <p className="sale-meta">
                      {movement.amount} unidades · {new Date(movement.createdAt).toLocaleString('pt-BR')}
                    </p>
                    {movement.note && <p className="sale-note">{movement.note}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    );
  };

  const renderFinance = () => {
    const financeMin = financeMinValue ? Number(financeMinValue) : null
    const financeMax = financeMaxValue ? Number(financeMaxValue) : null
    const financeSales = sales.filter((sale) => {
      const saleDate = sale.createdAt.slice(0, 10)
      if (financeDateStart && saleDate < financeDateStart) return false
      if (financeDateEnd && saleDate > financeDateEnd) return false
      if (financeClientFilter !== 'all' && sale.clientId !== financeClientFilter) return false
      if (financeMin !== null && sale.value < financeMin) return false
      if (financeMax !== null && sale.value > financeMax) return false
      return true
    })
    const paymentFilteredSales =
      financePaymentFilter === 'all'
        ? financeSales
        : financeSales.filter((sale) => sale.payments.some((payment) => payment.method === financePaymentFilter))
    const computedRevenue = paymentFilteredSales.reduce((sum, sale) => sum + sale.value, 0)
    const computedDiscount = paymentFilteredSales.reduce((sum, sale) => sum + sale.discount, 0)
    const totalOrders = paymentFilteredSales.length
    const averageTicket = totalOrders ? computedRevenue / totalOrders : 0
    const computedPaymentsBreakdown = paymentFilteredSales.reduce<Record<string, number>>((acc, sale) => {
      sale.payments.forEach((payment) => {
        acc[payment.method] = (acc[payment.method] ?? 0) + payment.amount
      })
      return acc
    }, {})
    const summaryPaymentBreakdown = financeSummary
      ? Object.entries(financeSummary.paymentsByMethod).reduce<Record<string, number>>((acc, [method, value]) => {
          const label = paymentMethodLabelFromKey(method)
          acc[label] = (acc[label] ?? 0) + value
          return acc
        }, {})
      : computedPaymentsBreakdown
    const extraPaymentEntries = Object.entries(summaryPaymentBreakdown).filter(
      ([label]) => !paymentMethods.includes(label as PaymentMethod),
    )
    const summaryRevenue = financeSummary?.totalRevenue ?? computedRevenue
    const summaryDiscount = financeSummary?.discountTotal ?? computedDiscount
    const summaryDelivered =
      financeSummary?.delivered ?? paymentFilteredSales.filter((sale) => sale.status === 'entregue').length
    const summaryPending =
      financeSummary?.pending ?? paymentFilteredSales.filter((sale) => sale.status === 'pendente').length
    const salesByClient = paymentFilteredSales.reduce<Record<string, number>>((acc, sale) => {
      acc[sale.clientId] = (acc[sale.clientId] ?? 0) + sale.value
      return acc
    }, {})
    const topClients = Object.entries(salesByClient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
    const financeClientOptions = [{ id: 'all', name: 'Todos os clientes' }, ...clients.map((client) => ({ id: client.id, name: client.name }))] as const

    return (
      <div className="page-stack">
        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Financeiro</p>
              <h2>Visão de faturamento e vendas</h2>
            </div>
            <div className="section-actions">
              {financeSummaryLoading && <span className="chip ghost">Atualizando…</span>}
              {financeSummaryError && <span className="chip alert">{financeSummaryError}</span>}
              <span className="chip ghost">{paymentFilteredSales.length} resultados</span>
            </div>
          </div>
          <div className="finance-metrics">
            <div className="metric-card">
              <p>Faturamento filtrado</p>
              <h3>{formatCurrency(summaryRevenue)}</h3>
              <span>Descontos aplicados: {formatCurrency(summaryDiscount)}</span>
            </div>
            <div className="metric-card">
              <p>Ticket médio</p>
              <h3>{averageTicket ? formatCurrency(averageTicket) : 'R$ 0,00'}</h3>
              <span>{totalOrders} pedidos no período</span>
            </div>
            <div className="metric-card">
              <p>Formas de pagamento</p>
              <div className="metric-bar">
                {paymentMethods.map((method) => {
                  const value = summaryPaymentBreakdown[method] ?? 0
                  if (!value) return null
                  const percent = summaryRevenue ? Math.round((value / summaryRevenue) * 100) : 0
                  return (
                    <div key={method}>
                      <strong>{method}</strong>
                      <span>{formatCurrency(value)} · {percent}%</span>
                    </div>
                  )
                })}
                {extraPaymentEntries.map(([label, value]) => {
                  const percent = summaryRevenue ? Math.round((value / summaryRevenue) * 100) : 0
                  return (
                    <div key={label}>
                      <strong>{label}</strong>
                      <span>{formatCurrency(value)} · {percent}%</span>
                    </div>
                  )
                })}
                {summaryRevenue === 0 && <span className="muted">Sem pagamentos registrados</span>}
              </div>
            </div>
            <div className="metric-card">
              <p>Status das vendas</p>
              <div className="metric-bar">
                <div>
                  <span>Entregues</span>
                  <strong>{summaryDelivered}</strong>
                </div>
                <div>
                  <span>Pendentes</span>
                  <strong>{summaryPending}</strong>
                </div>
              </div>
            </div>
            <div className="metric-card">
              <p>Top clientes</p>
              {topClients.length ? (
                <ul className="metric-list">
                  {topClients.map(([clientId, value]) => {
                    const client = clients.find((item) => item.id === clientId)
                    const fallbackSale = sales.find((sale) => sale.clientId === clientId)
                    return (
                      <li key={clientId}>
                        <strong>{client?.name ?? fallbackSale?.clientName ?? 'Cliente removido'}</strong>
                        <span>{formatCurrency(value)}</span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <span className="muted">Nenhum cliente no filtro atual.</span>
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Filtros</p>
              <h2>Refine análises</h2>
            </div>
          </div>
          <div className="filter-row finance">
            <label>
              Desde
              <input type="date" value={financeDateStart} onChange={(event) => setFinanceDateStart(event.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={financeDateEnd} onChange={(event) => setFinanceDateEnd(event.target.value)} />
            </label>
            <label>
              Cliente
              <select value={financeClientFilter} onChange={(event) => setFinanceClientFilter(event.target.value)}>
                {financeClientOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pagamento
              <select value={financePaymentFilter} onChange={(event) => setFinancePaymentFilter(event.target.value as typeof financePaymentFilter)}>
                <option value="all">Todos</option>
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Valor mínimo (R$)
              <input
                type="number"
                min={0}
                value={financeMinValue}
                onChange={(event) => setFinanceMinValue(event.target.value)}
              />
            </label>
            <label>
              Valor máximo (R$)
              <input
                type="number"
                min={0}
                value={financeMaxValue}
                onChange={(event) => setFinanceMaxValue(event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Pedidos filtrados</p>
              <h2>Detalhes financeiros</h2>
            </div>
          </div>
          <div className="finance-table">
            {paymentFilteredSales.map((sale) => {
              const client = clients.find((clientItem) => clientItem.id === sale.clientId)
              const paymentSummary = sale.payments.map((payment) => `${payment.method} · ${formatCurrency(payment.amount)}`).join(' | ')
              return (
                <div className="finance-row" key={sale.id}>
                  <div>
                    <p className="sale-id">#{sale.id}</p>
                    <p className="hero-sub">{client?.name ?? sale.clientName ?? 'Cliente removido'}</p>
                  </div>
                  <div>
                    <span>Faturado</span>
                    <strong>{formatCurrency(sale.value)}</strong>
                  </div>
                  <div>
                    <span>Desconto</span>
                    <strong>{formatCurrency(sale.discount)}</strong>
                  </div>
                  <div>
                    <span>Data</span>
                    <strong>{new Date(sale.createdAt).toLocaleDateString('pt-BR')}</strong>
                  </div>
                  <div className="finance-payments">
                    <span>Pagamentos</span>
                    <p>{paymentSummary}</p>
                  </div>
                </div>
              )
            })}
            {paymentFilteredSales.length === 0 && <p className="empty-state">Nenhum pedido com os filtros selecionados.</p>}
          </div>
        </section>
      </div>
    )
  }

  const renderAssistances = () => {
    const selectedSale = sales.find((sale) => (sale.backendId ?? sale.id) === assistanceForm.saleId)
    const productOptions = selectedSale
      ? selectedSale.items.reduce<StockItem[]>((acc, saleItem) => {
          const product = stockItems.find((item) => item.id === saleItem.productId)
          if (product && !acc.some((existing) => existing.id === product.id)) {
            acc.push(product)
          }
          return acc
        }, [])
      : []
    const normalizedAssistSearch = assistanceSearch.trim().toLowerCase()
    const filteredAssistances = assistances.filter((assistance) => {
      if (assistanceStatusFilter !== 'all' && assistance.status !== assistanceStatusFilter) {
        return false
      }
      const createdDate = assistance.createdAt.slice(0, 10)
      if (assistanceDateStart && createdDate < assistanceDateStart) return false
      if (assistanceDateEnd && createdDate > assistanceDateEnd) return false
      if (normalizedAssistSearch) {
        const sale = sales.find((item) => (item.backendId ?? item.id) === assistance.saleId)
        const client = sale ? clients.find((clientItem) => clientItem.id === sale.clientId) : null
        const product = stockItems.find((item) => item.id === assistance.productId)
        const blob = `${assistance.code ?? assistance.id} ${assistance.saleCode} ${client?.name ?? ''} ${product?.name ?? ''} ${assistance.defectDescription} ${assistance.factoryResponse}`.toLowerCase()
        if (!blob.includes(normalizedAssistSearch)) return false
      }
      return true
    })
    const canManageAssistances = isAdmin
    const openCount = assistances.filter((item) => item.status === 'aberta').length
    const concludedCount = assistances.filter((item) => item.status === 'concluida').length
    const canSubmitAssistance =
      canManageAssistances &&
      Boolean(selectedSale) &&
      Boolean(assistanceForm.productId && assistanceForm.defectDescription.trim())

    return (
      <div className="assistances page-stack">
        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Assistências</p>
              <h2>Atendimentos e garantias da loja</h2>
            </div>
            <div className="section-actions">
              {assistancesLoading && <span className="chip ghost">Carregando…</span>}
              {assistancesError && <span className="chip alert">{assistancesError}</span>}
              <span className="chip ghost">{assistances.length} registros</span>
            </div>
          </div>
          <div className="assist-overview-grid">
            <article className="spot-card">
              <p className="eyebrow">Abertas</p>
              <h3>{openCount}</h3>
              <p className="spot-note">Assistências aguardando solução.</p>
            </article>
            <article className="spot-card">
              <p className="eyebrow">Concluídas</p>
              <h3>{concludedCount}</h3>
              <p className="spot-note">Processos encerrados e comunicados.</p>
            </article>
            <article className="spot-card">
              <p className="eyebrow">Prazo médio</p>
              <h3>
                {assistances.length
                  ? `${Math.max(
                      1,
                      Math.round(
                        assistances.reduce((sum, assistance) => {
                          const created = new Date(assistance.createdAt).getTime()
                          const expected = new Date(assistance.expectedDate).getTime()
                          return sum + Math.max(0, expected - created)
                        }, 0) /
                          assistances.length /
                          (1000 * 60 * 60 * 24),
                      ),
                    )} dias`
                  : '—'}
              </h3>
              <p className="spot-note">Tempo entre abertura e resposta prevista.</p>
            </article>
          </div>
        </section>

        <section className="panel assist-form">
          <div className="section-head">
            <div>
              <p className="eyebrow">Registrar assistência</p>
              <h2>Conecte venda, produto e defeito relatado</h2>
            </div>
            <button
              className="ghost"
              type="button"
              onClick={() => setAssistanceForm(createAssistanceFormState(sales))}
              disabled={!canManageAssistances}
            >
              Limpar formulário
            </button>
          </div>
          <form className="assist-form-grid" onSubmit={handleRegisterAssistance}>
            <div className="assist-form-main">
              <label>
                Venda vinculada
                <select
                  value={assistanceForm.saleId}
                  onChange={(event) => {
                    const nextSaleId = event.target.value
                    const sale = sales.find((item) => (item.backendId ?? item.id) === nextSaleId)
                    setAssistanceForm((prev) => ({
                      ...prev,
                      saleId: nextSaleId,
                      productId: sale?.items[0]?.productId ?? '',
                    }))
                  }}
                  disabled={!sales.length || !canManageAssistances}
                >
                  {sales.map((sale) => {
                    const client = clients.find((clientItem) => clientItem.id === sale.clientId)
                    return (
                      <option key={sale.id} value={sale.backendId ?? sale.id}>
                        {sale.id} · {client?.name ?? sale.clientName ?? 'Cliente removido'}
                      </option>
                    )
                  })}
                  {!sales.length && <option value="">Cadastre uma venda para iniciar</option>}
                </select>
              </label>
              <label>
                Produto reportado
                <select
                  value={assistanceForm.productId}
                  onChange={(event) => setAssistanceForm((prev) => ({ ...prev, productId: event.target.value }))}
                  disabled={!productOptions.length || !canManageAssistances}
                >
                  {productOptions.map((product) => (
                    <option value={product.id} key={product.id}>
                      {product.name}
                    </option>
                  ))}
                  {!productOptions.length && <option value="">Selecione uma venda com itens</option>}
                </select>
              </label>
              <label>
                Defeito relatado
                <textarea
                  value={assistanceForm.defectDescription}
                  onChange={(event) => {
                    setAssistanceSubmitError(null)
                    setAssistanceForm((prev) => ({ ...prev, defectDescription: event.target.value }))
                  }}
                  placeholder="Descreva exatamente o que foi informado pelo cliente."
                  rows={4}
                  minLength={5}
                  required
                  disabled={!canManageAssistances}
                />
              </label>
              <label>
                Retorno da fábrica (opcional)
                <textarea
                  value={assistanceForm.factoryResponse}
                  onChange={(event) =>
                    setAssistanceForm((prev) => ({ ...prev, factoryResponse: event.target.value }))
                  }
                  placeholder="Parecer, protocolos ou instruções compartilhadas pela fábrica."
                  rows={3}
                  disabled={!canManageAssistances}
                />
              </label>
            </div>
            <aside className="assist-form-side">
              <label>
                Previsão de entrega/reparo
                <input
                  type="date"
                  value={assistanceForm.expectedDate}
                  onChange={(event) => setAssistanceForm((prev) => ({ ...prev, expectedDate: event.target.value }))}
                  disabled={!canManageAssistances}
                />
              </label>
              <label>
                Fotos do defeito
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleAssistancePhotoUpload}
                  disabled={assistanceForm.photos.length >= MAX_ASSISTANCE_PHOTOS || !canManageAssistances}
                />
                <span className="field-note">
                  {assistanceForm.photos.length}/{MAX_ASSISTANCE_PHOTOS} imagens anexadas
                </span>
              </label>
              <div className="photo-grid">
                {assistanceForm.photos.map((photo, index) => (
                  <div className="photo-thumb" key={index}>
                    <img src={photo} alt={`Foto ${index + 1}`} />
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => handleRemoveAssistancePhoto(index)}
                      disabled={!canManageAssistances}
                    >
                      Remover
                    </button>
                  </div>
                ))}
                {assistanceForm.photos.length === 0 && <p className="field-note">Sem fotos anexadas.</p>}
              </div>
            </aside>
            <div className="assist-actions">
              {!canManageAssistances && (
                <p className="field-note">
                  Apenas administradores podem registrar ou finalizar assistências.
                </p>
              )}
              {assistanceSubmitError && <p className="field-note error">{assistanceSubmitError}</p>}
              <button
                type="submit"
                className="primary"
                disabled={!canSubmitAssistance || assistanceSubmitLoading}
                title={
                  canSubmitAssistance ? 'Registrar assistência' : 'Selecione venda, produto e descreva o defeito'
                }
              >
                {assistanceSubmitLoading ? 'Registrando...' : 'Registrar assistência'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Timeline</p>
              <h2>Histórico e status</h2>
            </div>
            <span className="chip ghost">{filteredAssistances.length} resultados</span>
          </div>
          <div className="filter-row">
            <label>
              Buscar
              <input
                value={assistanceSearch}
                onChange={(event) => setAssistanceSearch(event.target.value)}
                placeholder="Cliente, produto ou código"
              />
            </label>
            <label>
              Status
              <select
                value={assistanceStatusFilter}
                onChange={(event) => setAssistanceStatusFilter(event.target.value as typeof assistanceStatusFilter)}
              >
                <option value="all">Todos</option>
                <option value="aberta">Abertos</option>
                <option value="concluida">Concluídos</option>
              </select>
            </label>
            <label>
              Desde
              <input type="date" value={assistanceDateStart} onChange={(event) => setAssistanceDateStart(event.target.value)} />
            </label>
            <label>
              Até
              <input type="date" value={assistanceDateEnd} onChange={(event) => setAssistanceDateEnd(event.target.value)} />
            </label>
          </div>
          <div className="assistance-grid">
            {filteredAssistances.map((assistance) => {
              const sale = sales.find((saleItem) => (saleItem.backendId ?? saleItem.id) === assistance.saleId)
              const client = sale ? clients.find((clientItem) => clientItem.id === sale.clientId) : null
              const product = stockItems.find((item) => item.id === assistance.productId)
              return (
                <article className={`assistance-card ${assistance.status}`} key={assistance.id}>
                  <header>
                    <div>
                      <p className="eyebrow">Assistência #{assistance.code ?? assistance.id}</p>
                      <h3>{product?.name ?? 'Produto removido'}</h3>
                      <p className="hero-sub">{client?.name ?? sale?.clientName ?? 'Cliente removido'}</p>
                    </div>
                    <span className={`status-pill ${assistance.status}`}>
                      {assistance.status === 'concluida' ? 'Concluída' : 'Aberta'}
                    </span>
                  </header>
                  <p className="assistance-description">{assistance.defectDescription}</p>
                  {assistance.factoryResponse && (
                    <p className="assistance-response">
                      <strong>Resposta da fábrica:</strong> {assistance.factoryResponse}
                    </p>
                  )}
                  <footer>
                    <div>
                      <span>Venda</span>
                      <strong>{assistance.saleCode}</strong>
                    </div>
                    <div>
                      <span>Previsto</span>
                      <strong>{new Date(assistance.expectedDate).toLocaleDateString('pt-BR')}</strong>
                    </div>
                    <div>
                      <span>Aberta em</span>
                      <strong>{new Date(assistance.createdAt).toLocaleDateString('pt-BR')}</strong>
                    </div>
                    <div>
                      <span>Responsável</span>
                      <strong>{assistance.owner}</strong>
                    </div>
                  </footer>
                  <div className="assistance-card-actions">
                    <button type="button" className="ghost" onClick={() => setAssistanceModal(assistance)}>
                      Ver detalhes
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={!canManageAssistances || assistance.status === 'concluida'}
                      onClick={() => {
                        if (!canManageAssistances || assistance.status === 'concluida') return
                        setAssistanceConfirm(assistance)
                      }}
                    >
                      {assistance.status === 'concluida' ? 'Finalizado' : 'Marcar como concluído'}
                    </button>
                  </div>
                </article>
              )
            })}
            {filteredAssistances.length === 0 && (
              <p className="empty-state">Nenhuma assistência encontrada com os filtros atuais.</p>
            )}
          </div>
        </section>
      </div>
    )
  }

  const renderContent = () => {
    switch (activePage) {
      case 'clientes':
        return renderClients()
      case 'sleepLab':
        return renderSleepLab()
      case 'estoque':
        return renderStock()
      case 'entregas':
        return renderDeliveries()
      case 'assistencias':
        return renderAssistances()
      case 'financeiro':
        return isAdmin ? renderFinance() : renderDashboard()
      default:
        return renderDashboard()
    }
  };

  if (!currentUser) {
    return renderLogin()
  }

  const visibleNavItems = navItems.filter((item) => item.id !== 'financeiro' || isAdmin)

  return (
    <>
    <div className="page">
      <div className={`layout ${collapsed ? 'is-collapsed' : ''}`}>
        <aside
          className={`sidebar ${collapsed ? 'collapsed' : ''}`}
          onMouseEnter={() => setCollapsed(false)}
          onMouseLeave={() => setCollapsed(true)}
        >
          <div className="brand">
            <div className="brand-mark">
              <img src="/sonhar-logo.jpg" alt="Sonhar Conforto" className="brand-logo" />
            </div>
            <div className="brand-text">
              <p className="eyebrow">Sonhar Conforto</p>
              <h3>V1.0.0</h3>
            </div>
          </div>
          <nav className="nav">
            {visibleNavItems.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${activePage === item.id ? 'active' : ''}`}
                title={collapsed ? item.label : undefined}
                aria-current={activePage === item.id ? 'page' : undefined}
                onClick={() => setActivePage(item.id)}
              >
                <span className="nav-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={item.icon} />
                  </svg>
                </span>
                <span className="nav-label">{item.label}</span>
                {activePage === item.id && <span className="dot" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-actions">
            <button className={`profile-circle${collapsed ? '' : ' expanded'}`} onClick={() => setProfileModalOpen(true)}>
              <span>{(currentUser?.name ?? 'Usuário').split(' ').map((n) => n[0]).join('').slice(0, 2)}</span>
              {!collapsed && (
                <div className="profile-circle-text">
                  <strong>{currentUser?.name ?? 'Usuário'}</strong>
                  <p>{currentUser ? roleLabels[currentUser.role] : ''}</p>
                </div>
              )}
            </button>
          </div>
        </aside>

        <main className="content">{renderContent()}</main>
      </div>

      {clientModalOpen && (
        <div className="modal-backdrop" onClick={closeClientModal}>
          <div className="modal client-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Clientes</p>
                <h2>{clientModalMode === 'create' ? 'Novo cadastro' : 'Editar cliente'}</h2>
              </div>
              <button className="text-button" onClick={closeClientModal}>
                Fechar
              </button>
            </div>
            <form className="client-form" onSubmit={handleClientModalSubmit}>
              <div className="client-form-section">
                <p className="form-title">Contato principal</p>
                <div className="client-form-grid two">
                  <label>
                    Nome completo
                    <input
                      value={clientModalForm.name}
                      onChange={(event) => setClientModalForm((prev) => ({ ...prev, name: event.target.value }))}
                      placeholder="Ex: Ana Souza"
                      required
                    />
                  </label>
                  <label>
                    Telefone
                    <input
                      value={formatPhone(clientModalForm.phone)}
                      onChange={(event) =>
                        setClientModalForm((prev) => ({ ...prev, phone: formatDigits(event.target.value) }))
                      }
                      placeholder="(11) 99999-9999"
                    />
                  </label>
                  <label>
                    CPF
                    <input
                      value={formatCpf(clientModalForm.cpf)}
                      onChange={(event) =>
                        setClientModalForm((prev) => ({ ...prev, cpf: formatDigits(event.target.value) }))
                      }
                      placeholder="000.000.000-00"
                    />
                  </label>
                  <div className="client-form-tip">
                    <span>Use o CPF correto para integrar com o Sleep Lab.</span>
                  </div>
                </div>
              </div>

              <div className="client-form-section">
                <p className="form-title">Endereço completo</p>
                <div className="client-form-grid three">
                  <label>
                    Rua / Avenida
                    <input
                      value={clientModalForm.addressStreet}
                      onChange={(event) =>
                        setClientModalForm((prev) => ({ ...prev, addressStreet: event.target.value }))
                      }
                      placeholder="Rua Aurora"
                    />
                  </label>
                  <label>
                    Número
                    <input
                      value={clientModalForm.addressNumber}
                      onChange={(event) =>
                        setClientModalForm((prev) => ({ ...prev, addressNumber: event.target.value }))
                      }
                      placeholder="215"
                    />
                  </label>
                  <label>
                    Bairro
                    <input
                      value={clientModalForm.addressNeighborhood}
                      onChange={(event) =>
                        setClientModalForm((prev) => ({ ...prev, addressNeighborhood: event.target.value }))
                      }
                      placeholder="Centro"
                    />
                  </label>
                  <label>
                    Cidade / UF
                    <input
                      value={clientModalForm.addressCity}
                      onChange={(event) =>
                        setClientModalForm((prev) => ({ ...prev, addressCity: event.target.value }))
                      }
                      placeholder="São Paulo – SP"
                    />
                  </label>
                  <label className="full-width">
                    Observações do local
                    <textarea
                      value={clientModalForm.addressNote}
                      onChange={(event) =>
                        setClientModalForm((prev) => ({ ...prev, addressNote: event.target.value }))
                      }
                      rows={2}
                      placeholder="Referência, portaria, horários ideais, etc."
                    />
                  </label>
                </div>
              </div>

              <div className="modal-actions">
                {clientModalError && <p className="login-error">{clientModalError}</p>}
                {clientModalMode === 'edit' && clientModalClientId && (
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={() => handleDeleteClient(clientModalClientId)}
                    disabled={clientModalLoading}
                  >
                    Excluir cliente
                  </button>
                )}
                <button className="primary" type="submit" disabled={clientModalLoading}>
                  {clientModalLoading
                    ? 'Salvando...'
                    : clientModalMode === 'create'
                      ? 'Cadastrar'
                      : 'Salvar alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {saleModalOpen && (
        <div className="modal-backdrop" onClick={closeSaleModal}>
          <div className="modal sale-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Sleep Lab</p>
                <h2>Novo pedido #{saleDraftId}</h2>
              </div>
              <button className="text-button" onClick={closeSaleModal}>
                Fechar
              </button>
            </div>
            <form className="simple-form" onSubmit={handleRegisterSale}>
              {(!clients.length || !stockItems.length) && (
                <p className="empty-state">
                  Para registrar uma venda, cadastre pelo menos um cliente e um produto em estoque.
                </p>
              )}
              <label>
                Cliente cadastrado
                <select
                  value={saleForm.clientId}
                  onChange={(event) => setSaleForm((prev) => ({ ...prev, clientId: event.target.value }))}
                  required
                >
                  {clients.length === 0 && <option value="">Cadastre um cliente primeiro</option>}
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sale-items-stack">
                <div className="sale-items-head">
                  <p className="form-title">Itens do pedido</p>
                  <button
                    type="button"
                    className="ghost"
                    onClick={addSaleItemRow}
                    disabled={!stockItems.length || saleModalLoading}
                  >
                    Adicionar item
                  </button>
                </div>
                {saleForm.items.length === 0 && (
                  <p className="empty-state">Nenhum item selecionado. Use "Adicionar item" para começar.</p>
     )}

                {saleForm.items.map((item, index) => {
                  const product = stockItems.find((stock) => stock.id === item.productId)
                  return (
                    <div className="sale-item-row" key={`${item.productId}-${index}`}>
                      <div className="sale-item-product">
                        <img
                          src={product?.imageUrl ?? 'https://via.placeholder.com/80x80.png?text=Produto'}
                          alt={product?.name ?? 'Produto'}
                        />
                        <div className="product-field">
                          <span className="product-label">Produto</span>
                          <select
                            value={item.productId}
                            onChange={(event) => {
                              const nextProduct = stockItems.find((stock) => stock.id === event.target.value)
                              updateSaleItemRow(index, {
                                productId: event.target.value,
                                unitPrice: nextProduct?.price ?? item.unitPrice,
                                discount: 0,
                              })
                            }}
                          >
                            {stockItems.map((stock) => (
                              <option key={stock.id} value={stock.id} disabled={stock.quantity <= 0}>
                                {stock.name} — {stock.quantity} em estoque
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="sale-item-fields">
                        <label>
                          Quantidade
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={item.quantity > 0 ? String(item.quantity) : ''}
                            onChange={(event) => {
                              const digits = formatDigits(event.target.value)
                              updateSaleItemRow(index, {
                                quantity: digits ? Number(digits) : 0,
                              })
                            }}
                            onBlur={() => {
                              if (!item.quantity || item.quantity < 1) {
                                updateSaleItemRow(index, { quantity: 1 })
                              }
                            }}
                            placeholder="0"
                          />
                          <span className="input-hint">Disponível: {product?.quantity ?? 0}</span>
                        </label>
                        <label>
                          Preço unitário (R$)
                          <NumericFormat
                            value={item.unitPrice === 0 ? '' : item.unitPrice}
                            thousandSeparator="."
                            decimalSeparator=","
                            decimalScale={2}
                            fixedDecimalScale
                            allowNegative={false}
                            inputMode="decimal"
                            placeholder="0,00"
                            onValueChange={({ floatValue }) =>
                              updateSaleItemRow(index, {
                                unitPrice: floatValue ?? 0,
                              })
                            }
                          />
                        </label>
                        <label>
                          Desconto por unidade (R$)
                          <NumericFormat
                            value={item.discount === 0 ? '' : item.discount}
                            thousandSeparator="."
                            decimalSeparator=","
                            decimalScale={2}
                            fixedDecimalScale
                            allowNegative={false}
                            inputMode="decimal"
                            placeholder="0,00"
                            onValueChange={({ floatValue }) =>
                              updateSaleItemRow(index, {
                                discount: floatValue ?? 0,
                              })
                            }
                          />
                        </label>
                        {saleForm.items.length > 1 && (
                          <div className="sale-item-action">
                            <button
                              type="button"
                              className="ghost danger"
                              onClick={() => removeSaleItemRow(index)}
                              disabled={saleModalLoading}
                            >
                              Remover
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <label>
                Data de entrega
                <input
                  type="date"
                  value={saleForm.deliveryDate}
                  onChange={(event) =>
                    setSaleForm((prev) => ({
                      ...prev,
                      deliveryDate: event.target.value,
                    }))
                  }
                  required
                />
              </label>

              <label>
                Observações
                <textarea
                  value={saleForm.note}
                  onChange={(event) => setSaleForm((prev) => ({ ...prev, note: event.target.value }))}
                  rows={3}
                  placeholder="Detalhes de entrega, montagem, etc."
                />
              </label>
              <label>
                Desconto (R$)
                <NumericFormat
                  value={saleForm.discount === 0 ? '' : saleForm.discount}
                  thousandSeparator="."
                  decimalSeparator=","
                  decimalScale={2}
                  fixedDecimalScale
                  allowNegative={false}
                  inputMode="decimal"
                  placeholder="0,00"
                  onValueChange={({ floatValue }) =>
                    setSaleForm((prev) => ({
                      ...prev,
                      discount: floatValue ?? 0,
                    }))
                  }
                />
              </label>
              <div className="sale-summary">
                <div>
                  <p>
                    Subtotal <strong>{formatCurrency(saleSubtotal)}</strong>
                  </p>
                  <p>
                    Desconto <strong>-{formatCurrency(normalizedDiscount)}</strong>
                  </p>
                  <p className="sale-total">
                    Total <strong>{formatCurrency(saleTotal)}</strong>
                  </p>
                </div>
              </div>
              <div className="sale-payments-stack">
                <div className="sale-items-head">
                  <p className="form-title">Formas de pagamento</p>
                  <button type="button" className="ghost" onClick={addPaymentRow} disabled={saleModalLoading}>
                    Adicionar pagamento
                  </button>
                </div>
                {saleForm.payments.map((payment, index) => (
                  <div className="payment-row" key={payment.id}>
                    <label>
                      Método
                      <select
                        value={payment.method}
                        onChange={(event) =>
                          updatePaymentRow(index, { method: event.target.value as PaymentMethod })
                        }
                      >
                        {paymentMethods.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Valor (R$)
                      <NumericFormat
                        value={payment.amount === 0 ? '' : payment.amount}
                        thousandSeparator="."
                        decimalSeparator=","
                        decimalScale={2}
                        fixedDecimalScale
                        allowNegative={false}
                        inputMode="decimal"
                        placeholder="0,00"
                        onValueChange={({ floatValue }) =>
                          updatePaymentRow(index, {
                            amount: floatValue ?? 0,
                          })
                        }
                      />
                    </label>
                    {payment.method === 'Cartão de crédito' && (
                      <label>
                        Parcelas
                        <input
                          type="number"
                          min={1}
                          value={payment.installments}
                          onChange={(event) =>
                            updatePaymentRow(index, { installments: Number(event.target.value) })
                          }
                        />
                      </label>
                    )}
                    {saleForm.payments.length > 1 && (
                      <button
                        type="button"
                        className="ghost danger"
                        onClick={() => removePaymentRow(index)}
                        disabled={saleModalLoading}
                      >
                        Remover
                      </button>
                    )}
                  </div>
                ))}
                <p className={`payment-balance ${paymentBalanced ? 'ok' : 'warn'}`}>
                  Valor total: {formatCurrency(saleTotal)} · Recebimentos:{' '}
                  <strong>
                    {paymentBalanced
                      ? 'Conferido'
                      : `${paymentDiff > 0 ? 'Faltam' : 'Sobram'} ${formatCurrency(Math.abs(paymentDiff))}`}
                  </strong>
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost" onClick={closeSaleModal}>
                  Cancelar
                </button>
                {saleModalError && <p className="login-error">{saleModalError}</p>}
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    saleModalLoading ||
                    !clients.length ||
                    !stockItems.length ||
                    !saleForm.items.length ||
                    !paymentBalanced
                  }
                >
                  {saleModalLoading ? 'Registrando...' : 'Confirmar venda'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {profileModalOpen && (
        <div className="modal-backdrop" onClick={() => setProfileModalOpen(false)}>
          <div className="modal profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Perfil</p>
                <h2>{currentUser?.name ?? 'Usuário'}</h2>
                <p className="hero-sub">{currentUser ? roleLabels[currentUser.role] : ''}</p>
              </div>
              <button className="text-button" onClick={() => setProfileModalOpen(false)}>
                Fechar
              </button>
            </div>
            <div className="profile-info-grid">
              <div>
                <span className="field-label">E-mail corporativo</span>
                <p>{currentUser?.email ?? '—'}</p>
              </div>
              <div>
                <span className="field-label">Telefone</span>
                <p>{currentUser?.phone ?? '—'}</p>
              </div>
            </div>
            <div className="profile-actions">
              {isAdmin && (
                <button className="ghost" type="button" onClick={() => setUserManagerOpen(true)}>
                  Gerenciar usuários
                </button>
              )}
              <button className="ghost" type="button">
                Preferências
              </button>
              <button className="ghost danger" type="button" onClick={handleLogout}>
                Sair do CRM
              </button>
            </div>
          </div>
        </div>
      )}

      {userManagerOpen && isAdmin && (
        <div className="modal-backdrop" onClick={() => setUserManagerOpen(false)}>
          <div className="modal user-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Usuários</p>
                <h2>Gerenciar equipes e permissões</h2>
              </div>
              <button className="text-button" onClick={() => setUserManagerOpen(false)}>
                Fechar
              </button>
            </div>
            {usersLoading && <p className="field-note">Carregando usuários...</p>}
            {usersError && <p className="login-error">{usersError}</p>}
            <div className="user-grid">
              {users.map((user) => (
                <div className="user-card" key={user.id}>
                  <div>
                    <h3>{user.name}</h3>
                    <p className="hero-sub">{roleLabels[user.role]}</p>
                  </div>
                  <span className={`status-pill ${user.active ? 'concluida' : 'warning'}`}>
                    {user.active ? 'Ativo' : 'Inativo'}
                  </span>
                  <p className="user-contact">{user.email}</p>
                  <p className="user-contact">{user.phone || 'Sem telefone'}</p>
                  <div className="user-card-actions">
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => handleResetUserPassword(user.id)}
                      disabled={userActionLoading}
                    >
                      Redefinir senha
                    </button>
                    {user.role !== 'admin' && (
                      <>
                        <button
                          className="ghost"
                          type="button"
                          onClick={() => handleToggleUserActive(user.id)}
                          disabled={userActionLoading}
                        >
                          {user.active ? 'Desativar' : 'Reativar'}
                        </button>
                        <button
                          className="ghost danger"
                          type="button"
                          onClick={() => handleDeleteUserAccount(user.id)}
                          disabled={userActionLoading}
                        >
                          Remover usuário
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {users.length === 0 && !usersLoading && <p className="empty-state">Nenhum usuário encontrado.</p>}
            {userManagerNotice && <p className="user-notice">{userManagerNotice}</p>}
            {userInviteTempPassword && (
              <p className="user-notice">
                Senha temporária: <strong>{userInviteTempPassword}</strong>
              </p>
            )}
            {userActionError && <p className="login-error">{userActionError}</p>}
            <form className="user-form" onSubmit={handleAddUser}>
              <p className="form-title">Adicionar novo usuário</p>
              <div className="user-form-grid">
                <label>
                  Nome completo
                  <input
                    value={userForm.name}
                    onChange={(event) => setUserForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Ex: Juliana Costa"
                    required
                  />
                </label>
                <label>
                  E-mail
                  <input
                    type="email"
                    value={userForm.email}
                    onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))}
                    placeholder="email@empresa.com"
                    required
                  />
                </label>
                <label>
                  Telefone
                  <input
                    value={formatPhone(userForm.phone)}
                  onChange={(event) => setUserForm((prev) => ({ ...prev, phone: formatDigits(event.target.value) }))}
                  placeholder="(11) 99999-9999"
                />
              </label>
                <label>
                  Permissão
                  <select
                    value={userForm.role}
                    onChange={(event) =>
                      setUserForm((prev) => ({ ...prev, role: event.target.value as UserRole }))
                    }
                  >
                    <option value="seller">Vendedor</option>
                    <option value="admin">Administrador</option>
                  </select>
                </label>
              </div>
              <p className="field-note">
                A senha temporária é gerada automaticamente e aparecerá aqui após criar ou redefinir um usuário.
              </p>
              <div className="modal-actions">
                <button className="primary" type="submit" disabled={userActionLoading}>
                  {userActionLoading ? 'Processando...' : 'Adicionar usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {assistanceModal &&
        (() => {
          const modalSale = sales.find((sale) => (sale.backendId ?? sale.id) === assistanceModal.saleId)
          const modalClient = modalSale ? clients.find((client) => client.id === modalSale.clientId) : null
          const modalProduct = stockItems.find((item) => item.id === assistanceModal.productId)
          const expectedLabel = new Date(assistanceModal.expectedDate).toLocaleDateString('pt-BR')
          const createdLabel = new Date(assistanceModal.createdAt).toLocaleDateString('pt-BR')
          return (
            <div className="modal-backdrop" onClick={() => setAssistanceModal(null)}>
              <div className="modal assistance-modal" onClick={(event) => event.stopPropagation()}>
                <div className="section-head assistance-modal-head">
                  <div>
                    <p className="eyebrow">Assistência #{assistanceModal.code ?? assistanceModal.id}</p>
                    <h2>{modalProduct?.name ?? 'Produto removido'}</h2>
                    <p className="hero-sub">{modalClient?.name ?? 'Cliente removido'}</p>
                  </div>
                  <button className="text-button" onClick={() => setAssistanceModal(null)}>
                    Fechar
                  </button>
                </div>
                <div className="assist-modal-summary">
                  <div>
                    <span>Venda vinculada</span>
                    <strong>{assistanceModal.saleCode || modalSale?.id || '-'}</strong>
                    <small>{modalSale ? new Date(modalSale.createdAt).toLocaleDateString('pt-BR') : 'Sem data'}</small>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong className={`status-pill ${assistanceModal.status}`}>
                      {assistanceModal.status === 'concluida' ? 'Concluída' : 'Aberta'}
                    </strong>
                    <small>Aberta em {createdLabel}</small>
                  </div>
                  <div>
                    <span>Responsável</span>
                    <strong>{assistanceModal.owner}</strong>
                    <small>Gestão do CRM</small>
                  </div>
                  <div>
                    <span>Entrega prevista</span>
                    <strong>{expectedLabel}</strong>
                    <small>{assistanceModal.status === 'concluida' ? 'Processo encerrado' : 'Em acompanhamento'}</small>
                  </div>
                </div>
                <div className="assist-modal-panels">
                  <article className="assist-modal-panel">
                    <span className="field-label">Defeito relatado</span>
                    <p>{assistanceModal.defectDescription}</p>
                  </article>
                  <article className="assist-modal-panel">
                    <span className="field-label">Resposta da fábrica</span>
                    <p>{assistanceModal.factoryResponse || 'Sem retorno registrado por enquanto.'}</p>
                  </article>
                </div>
                <div className="assist-modal-panels">
                  <article className="assist-modal-panel">
                    <span className="field-label">Produto</span>
                    <p>{modalProduct ? `${modalProduct.name} · ${modalProduct.sku}` : 'Removido do catálogo.'}</p>
                  </article>
                  <article className="assist-modal-panel">
                    <span className="field-label">Timeline</span>
                    <p>
                      Aberta em {createdLabel}.{' '}
                      {assistanceModal.status === 'concluida' ? 'Assistência finalizada.' : 'Acompanhando retorno da fábrica.'}
                    </p>
                  </article>
                </div>
                {assistanceModal.photos.length > 0 ? (
                  <div className="assist-modal-photos">
                    {assistanceModal.photos.map((photo, index) => (
                      <img src={photo} key={index} alt={`Foto ${index + 1}`} />
                    ))}
                  </div>
                ) : (
                  <p className="field-note">Nenhuma foto anexada a este atendimento.</p>
                )}
              </div>
            </div>
          )
        })()}

      {confirmDeliveryState && (
        <div className="modal-backdrop" onClick={() => setConfirmDeliveryState(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Entregas</p>
                <h2>Confirmar entrega</h2>
              </div>
              <button className="text-button" onClick={() => setConfirmDeliveryState(null)}>
                Fechar
              </button>
            </div>
            <div className="modal-body">
              <p>
                Confirma a entrega do pedido <strong>#{confirmDeliveryState.sale.id}</strong>{' '}
                <>
                  para{' '}
                  <strong>
                    {confirmDeliveryClient?.name ?? confirmDeliveryState.sale.clientName ?? 'cliente'}
                  </strong>
                </>
                ?
              </p>
              <p className="field-note">
                Essa ação não pode ser desfeita e libera o estoque reservado desse pedido.
              </p>
            </div>
            <div className="modal-actions">
              <button className="ghost" type="button" onClick={() => setConfirmDeliveryState(null)}>
                Cancelar
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  handleMarkDelivered(confirmDeliveryState.sale.id)
                  if (confirmDeliveryState.redirect) {
                    setActivePage(confirmDeliveryState.redirect)
                  }
                  setConfirmDeliveryState(null)
                }}
              >
                Confirmar entrega
              </button>
            </div>
          </div>
        </div>
      )}

      {assistanceConfirm && (
        <div className="modal-backdrop" onClick={() => setAssistanceConfirm(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <p className="eyebrow">Assistências</p>
                <h2>Finalizar atendimento</h2>
              </div>
              <button className="text-button" onClick={() => setAssistanceConfirm(null)}>
                Fechar
              </button>
            </div>
            <div className="modal-body">
              <p>
                Tem certeza que deseja marcar a assistência{' '}
                <strong>#{assistanceConfirm.code ?? assistanceConfirm.id}</strong> como concluída?
              </p>
              <p className="field-note">
                O cliente será considerado atendido e o registro ficará arquivado como finalizado.
              </p>
            </div>
            <div className="modal-actions">
              <button className="ghost" type="button" onClick={() => setAssistanceConfirm(null)}>
                Cancelar
              </button>
              <button
                className="primary"
                type="button"
                disabled={assistanceStatusLoading || !isAdmin}
                onClick={async () => {
                  await handleCompleteAssistance(assistanceConfirm.id)
                }}
              >
                {assistanceStatusLoading ? 'Atualizando...' : 'Confirmar conclusão'}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptModalOpen && receiptSale && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setReceiptModalOpen(false)
            setReceiptSale(null)
          }}
        >
          <div className="modal receipt-modal" onClick={(event) => event.stopPropagation()}>
            <div className="receipt-modal-head">
              <div>
                <p className="eyebrow">Recibo</p>
                <h2>Pedido #{receiptSale.id} registrado</h2>
              </div>
              <div className="receipt-head-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setReceiptModalOpen(false)
                    setReceiptSale(null)
                  }}
                >
                  Fechar
                </button>
                <button type="button" className="primary" onClick={handleDownloadReceipt}>
                  Salvar / Imprimir PDF
                </button>
              </div>
            </div>
            <div className="receipt-body">
              <div className="receipt-paper" ref={receiptContentRef}>
                {renderReceiptSections(receiptSale)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}

export default App
