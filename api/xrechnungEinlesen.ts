// ── XRechnung-Einleser (CII, EN 16931) ─────────────────────────────────────
// Parst eingehende E-Rechnungen im CrossIndustryInvoice-Format und prueft
// die Summen (Zeilen → Steuer → Gesamt) zur Validierung.
import { XMLParser } from "fast-xml-parser";

export interface EingehendeRechnung {
  nummer: string;
  datum: string | null;
  faellig: string | null;
  lieferant: string;
  lieferantKennung: string | null;
  kaeufer: { name: string; strasse: string | null; plz: string | null; ort: string | null } | null;
  positionen: {
    bezeichnung: string;
    menge: number;
    einheit: string;
    einzelpreis: number;
    ustSatz: number;
    netto: number;
  }[];
  netto: number;
  ust: number;
  brutto: number;
  waehrung: string;
  guideline: string | null;
}

const EINHEIT_LABEL: Record<string, string> = {
  C62: "Stück", HUR: "Stunde", DAY: "Tag", KGM: "kg", LTR: "l", MTR: "m",
  MTK: "m²", MTQ: "m³", SET: "Set", XPK: "Paket", CT: "Karton", MIN: "Minute",
};

// Knoten mit XML-Attributen werden vom Parser als Objekt { #text, @_attr }
// geliefert — hier den eigentlichen Wert herausziehen.
function wert(v: unknown): unknown {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return o["#text"];
  }
  return v;
}

function num(v: unknown): number {
  v = wert(v);
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function text(v: unknown): string {
  const w = wert(v);
  return w === undefined || w === null ? "" : String(w);
}

function datum102(roh: unknown): string | null {
  const s = text(roh).trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function alsArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function lesen<K extends string>(obj: Record<string, unknown>, key: K): unknown {
  // fast-xml-parser mit removeNSPrefix liefert lokale Namen
  return obj?.[key];
}

export function analysiereXrechnung(xml: string): {
  daten: EingehendeRechnung;
  fehler: string[];
  warnungen: string[];
} {
  const fehler: string[] = [];
  const warnungen: string[] = [];

  let doc: Record<string, unknown>;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
    });
    doc = parser.parse(xml);
  } catch (e) {
    return {
      daten: null as never,
      fehler: [`XML nicht lesbar: ${e instanceof Error ? e.message : e}`],
      warnungen,
    };
  }

  const root = (doc["CrossIndustryInvoice"] ?? doc["CrossIndustryDocument"]) as
    | Record<string, unknown>
    | undefined;
  if (!root) {
    return {
      daten: null as never,
      fehler: ["Kein CII-Dokument (CrossIndustryInvoice) — ist das eine XRechnung/ZUGFeRD-XML?"],
      warnungen,
    };
  }

  const ctx = lesen(root, "ExchangedDocumentContext") as Record<string, unknown> | undefined;
  const guideline = ctx
    ? text(
        (lesen(ctx, "GuidelineSpecifiedDocumentContextParameter") as Record<string, unknown> | undefined)
          ?.["ID"],
      ) || null
    : null;

  const kopf = lesen(root, "ExchangedDocument") as Record<string, unknown> | undefined;
  const nummer = text(kopf?.["ID"]).trim();
  const datum = datum102(
    (kopf?.["IssueDateTime"] as Record<string, unknown> | undefined)?.["DateTimeString"],
  );

  const trans = lesen(root, "SupplyChainTradeTransaction") as Record<string, unknown> | undefined;
  const agreement = trans?.["ApplicableHeaderTradeAgreement"] as Record<string, unknown> | undefined;
  const seller = agreement?.["SellerTradeParty"] as Record<string, unknown> | undefined;
  const lieferant = text(seller?.["Name"]).trim();
  // Kaeufer (fuer Altbestand-Import eigener AUSGEHENDER Rechnungen, v1.3)
  const buyer = agreement?.["BuyerTradeParty"] as Record<string, unknown> | undefined;
  const buyerAdr = buyer?.["PostalTradeAddress"] as Record<string, unknown> | undefined;
  const kaeufer = buyer
    ? {
        name: text(buyer["Name"]).trim(),
        strasse: buyerAdr ? text(buyerAdr["LineOne"]).trim() || null : null,
        plz: buyerAdr ? text(buyerAdr["PostcodeCode"]).trim() || null : null,
        ort: buyerAdr ? text(buyerAdr["CityName"]).trim() || null : null,
      }
    : null;
  let lieferantKennung: string | null = null;
  const steuerReg = alsArray(seller?.["SpecifiedTaxRegistration"] as never);
  for (const sr of steuerReg) {
    const id = (sr as Record<string, unknown>)?.["ID"];
    if (id) {
      lieferantKennung = text(id);
      break;
    }
  }

  const delivery = trans?.["ApplicableHeaderTradeDelivery"];
  void delivery;
  const settlement = trans?.["ApplicableHeaderTradeSettlement"] as Record<string, unknown> | undefined;
  const summation = settlement?.["SpecifiedTradeSettlementHeaderMonetarySummation"] as
    | Record<string, unknown>
    | undefined;
  const waehrung = summation
    ? text((summation["GrandTotalAmount"] as Record<string, unknown> | undefined)?.["@_currencyID"]) || "EUR"
    : "EUR";

  const brutto = num(summation?.["GrandTotalAmount"]);
  const netto = num(summation?.["TaxBasisTotalAmount"] ?? summation?.["TaxBasisAmount"]);
  const ust = alsArray(summation?.["TaxTotalAmount"]).reduce((a: number, t) => a + num(t), 0);

  let faellig: string | null = null;
  const terms = alsArray(settlement?.["SpecifiedTradePaymentTerms"] as never);
  for (const t of terms) {
    const d = (t as Record<string, unknown>)?.["DueDateDateTime"] as Record<string, unknown> | undefined;
    if (d) { faellig = datum102(d["DateTimeString"]); break; }
  }

  // Positionen
  const positionen: EingehendeRechnung["positionen"] = [];
  const zeilen = alsArray(trans?.["IncludedSupplyChainTradeLineItem"] as never);
  for (const z of zeilen) {
    const zeile = z as Record<string, unknown>;
    const doc2 = zeile["AssociatedDocumentLineDocument"] as Record<string, unknown> | undefined;
    const produkt = zeile["SpecifiedTradeProduct"] as Record<string, unknown> | undefined;
    const bezeichnung = text(produkt?.["Name"] ?? doc2?.["LineID"] ?? "Position").trim() || "Position";

    const tradeProduct = zeile["SpecifiedLineTradeAgreement"] as Record<string, unknown> | undefined;
    const nettoPreis = num(
      (tradeProduct?.["NetPriceProductTradePrice"] as Record<string, unknown> | undefined)?.[
        "ChargeAmount"
      ],
    );
    const lieferung = zeile["SpecifiedLineTradeDelivery"] as Record<string, unknown> | undefined;
    const mengeObj = lieferung?.["BilledQuantity"] as Record<string, unknown> | undefined;
    const menge = num(mengeObj);
    const einheitCode = text(mengeObj?.["@_unitCode"]) || "C62";

    const abrechnung = zeile["SpecifiedLineTradeSettlement"] as Record<string, unknown> | undefined;
    const steuer = abrechnung?.["ApplicableTradeTax"] as Record<string, unknown> | undefined;
    const ustSatz = num(steuer?.["RateApplicablePercent"]);
    const summe = num(
      (abrechnung?.["SpecifiedTradeSettlementLineMonetarySummation"] as Record<string, unknown> | undefined)?.[
        "LineTotalAmount"
      ],
    );

    positionen.push({
      bezeichnung,
      menge,
      einheit: EINHEIT_LABEL[einheitCode] ?? einheitCode,
      einzelpreis: nettoPreis,
      ustSatz,
      netto: summe,
    });
  }

  // ── Validierung ───────────────────────────────────────────────────────────
  if (!nummer) fehler.push("Rechnungsnummer fehlt (BT-1).");
  if (!datum) fehler.push("Rechnungsdatum fehlt oder ist unlesbar (BT-2).");
  if (!lieferant) fehler.push("Verkäufer/Lieferant fehlt.");
  if (positionen.length === 0) warnungen.push("Keine Positionen gefunden — nur Summen importiert.");

  const posSumme = positionen.reduce((a, p) => a + p.netto, 0);
  if (positionen.length > 0 && Math.abs(posSumme - netto) > 0.02) {
    warnungen.push(
      `Positionssumme (${posSumme.toFixed(2)}) weicht von der Bemessungsgrundlage (${netto.toFixed(2)}) ab — bitte prüfen.`,
    );
  }
  if (Math.abs(netto + ust - brutto) > 0.02) {
    warnungen.push(
      `Summenprüfung: Netto ${netto.toFixed(2)} + USt ${ust.toFixed(2)} ≠ Brutto ${brutto.toFixed(2)} — bitte prüfen.`,
    );
  }
  if (guideline && !guideline.includes("xrechnung") && !guideline.includes("en16931")) {
    warnungen.push(`Ungewöhnliche Profil-Kennung: ${guideline}`);
  }

  return {
    daten: {
      nummer,
      datum,
      faellig,
      lieferant,
      lieferantKennung,
      kaeufer,
      positionen,
      netto,
      ust,
      brutto,
      waehrung,
      guideline,
    },
    fehler,
    warnungen,
  };
}
