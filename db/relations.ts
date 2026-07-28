import { relations } from "drizzle-orm";
import {
  invoices,
  invoiceItems,
  creditNotes,
  creditNoteItems,
  customers,
  bankAccounts,
  suppliers,
  purchaseOrders,
  purchaseOrderItems,
  deliveryNotes,
  deliveryNoteItems,
  reminders,
  offers,
  offerItems,
  products,
  konditionen,
} from "./schema";

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
  bankAccount: one(bankAccounts, {
    fields: [invoices.bankAccountId],
    references: [bankAccounts.id],
  }),
  items: many(invoiceItems),
  creditNotes: many(creditNotes),
  deliveryNotes: many(deliveryNotes),
  reminders: many(reminders),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
}));

export const creditNotesRelations = relations(creditNotes, ({ one, many }) => ({
  invoice: one(invoices, {
    fields: [creditNotes.invoiceId],
    references: [invoices.id],
  }),
  items: many(creditNoteItems),
}));

export const creditNoteItemsRelations = relations(creditNoteItems, ({ one }) => ({
  creditNote: one(creditNotes, {
    fields: [creditNoteItems.creditNoteId],
    references: [creditNotes.id],
  }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
  items: many(purchaseOrderItems),
}));

export const purchaseOrderItemsRelations = relations(
  purchaseOrderItems,
  ({ one }) => ({
    purchaseOrder: one(purchaseOrders, {
      fields: [purchaseOrderItems.purchaseOrderId],
      references: [purchaseOrders.id],
    }),
  }),
);

export const deliveryNotesRelations = relations(deliveryNotes, ({ one, many }) => ({
  customer: one(customers, {
    fields: [deliveryNotes.customerId],
    references: [customers.id],
  }),
  invoice: one(invoices, {
    fields: [deliveryNotes.invoiceId],
    references: [invoices.id],
  }),
  items: many(deliveryNoteItems),
}));

export const deliveryNoteItemsRelations = relations(
  deliveryNoteItems,
  ({ one }) => ({
    deliveryNote: one(deliveryNotes, {
      fields: [deliveryNoteItems.deliveryNoteId],
      references: [deliveryNotes.id],
    }),
  }),
);

export const remindersRelations = relations(reminders, ({ one }) => ({
  invoice: one(invoices, {
    fields: [reminders.invoiceId],
    references: [invoices.id],
  }),
}));

export const offersRelations = relations(offers, ({ one, many }) => ({
  customer: one(customers, {
    fields: [offers.customerId],
    references: [customers.id],
  }),
  items: many(offerItems),
}));

export const offerItemsRelations = relations(offerItems, ({ one }) => ({
  offer: one(offers, {
    fields: [offerItems.offerId],
    references: [offers.id],
  }),
}));


export const konditionenRelations = relations(konditionen, ({ one }) => ({
  product: one(products, {
    fields: [konditionen.productId],
    references: [products.id],
  }),
}));
