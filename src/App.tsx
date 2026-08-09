import { Routes, Route } from "react-router";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Statistics from "@/pages/Statistics";
import Banking from "@/pages/Banking";
import InvoiceImport from "@/pages/InvoiceImport";
import NachweisImport from "@/pages/NachweisImport";
import Invoices from "@/pages/Invoices";
import InvoiceDetail from "@/pages/InvoiceDetail";
import Offers from "@/pages/Offers";
import OfferDetail from "@/pages/OfferDetail";
import CreditNotes from "@/pages/CreditNotes";
import IncomingInvoices from "@/pages/IncomingInvoices";
import CreditNoteDetail from "@/pages/CreditNoteDetail";
import DeliveryNotes from "@/pages/DeliveryNotes";
import DeliveryNoteDetail from "@/pages/DeliveryNoteDetail";
import PurchaseOrders from "@/pages/PurchaseOrders";
import PurchaseOrderDetail from "@/pages/PurchaseOrderDetail";
import Customers from "@/pages/Customers";
import Suppliers from "@/pages/Suppliers";
import Products from "@/pages/Products";
import Lager from "@/pages/Lager";
import Import from "@/pages/Import";
import Posteingang from "@/pages/Posteingang";
import Zahlungsziele from "@/pages/Zahlungsziele";
import SettingsPage from "@/pages/Settings";
import Unternehmen from "@/pages/Unternehmen";
import Login from "./pages/Login"
import NotFound from "./pages/NotFound"

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/statistik" element={<Statistics />} />
        <Route path="/import" element={<Import />} />
        <Route path="/posteingang" element={<Posteingang />} />
        <Route path="/zahlungsziele" element={<Zahlungsziele />} />
        <Route path="/bank" element={<Banking />} />
        <Route path="/rechnungen/importieren" element={<InvoiceImport />} />
        <Route path="/rechnungen/nachweis" element={<NachweisImport />} />
        <Route path="/angebote" element={<Offers />} />
        <Route path="/angebote/:id" element={<OfferDetail />} />
        <Route path="/rechnungen" element={<Invoices />} />
        <Route path="/rechnungen/:id" element={<InvoiceDetail />} />
        <Route path="/gutschriften" element={<CreditNotes />} />
        <Route path="/e-rechnungen" element={<IncomingInvoices />} />
        <Route path="/gutschriften/:id" element={<CreditNoteDetail />} />
        <Route path="/lieferscheine" element={<DeliveryNotes />} />
        <Route path="/lieferscheine/:id" element={<DeliveryNoteDetail />} />
        <Route path="/bestellungen" element={<PurchaseOrders />} />
        <Route path="/bestellungen/:id" element={<PurchaseOrderDetail />} />
        <Route path="/kunden" element={<Customers />} />
        <Route path="/lieferanten" element={<Suppliers />} />
        <Route path="/produkte" element={<Products />} />
        <Route path="/lager" element={<Lager />} />
        <Route path="/unternehmen" element={<Unternehmen />} />
        <Route path="/einstellungen" element={<SettingsPage />} />
      </Route>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
