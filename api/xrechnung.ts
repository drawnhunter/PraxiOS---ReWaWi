// ── XRechnung 3.0 (CII-Syntax, EN 16931) — XML-Generator ────────────────────
// Erzeugt eine XRechnung im CrossIndustryInvoice-Format aus einer finalisierten
// Rechnung. Referenz: KoSIT XRechnung 3.0 / ZUGFeRD CII-Struktur.
import { computeTotals } from "./queries/invoicing";

export interface XrechnungEingabe {
  nummer: string;
  rechnungsdatum: string; // JJJJ-MM-TT
  faelligkeitsdatum: string | null;
  leistungsdatum: string | null;
  firma: {
    name: string;
    strasse: string;
    plz: string;
    ort: string;
    land: string;
    email: string | null;
    telefon: string | null;
    steuernummer: string | null;
    ustIdNr: string | null;
    handelsregister: string | null;
  };
  kunde: {
    name: string;
    strasse: string;
    plz: string;
    ort: string;
    land: string;
    email: string | null;
  };
  bank: { iban: string; bic?: string | null } | null;
  items: {
    bezeichnung: string;
    menge: string;
    einheit: string;
    einzelpreis: string;
    ustSatz: number;
  }[];
}

// UN/ECE Recommendation 20 — gebräuchliche Einheiten
const EINHEIT_CODES: Record<string, string> = {
  stück: "C62", stk: "C62", "stk.": "C62", einheit: "C62",
  stunde: "HUR", stunden: "HUR", std: "HUR", minute: "MIN",
  tag: "DAY", tage: "DAY",
  kg: "KGM", kilogramm: "KGM", g: "GRM", gramm: "GRM",
  l: "LTR", liter: "LTR", ml: "MLT",
  m: "MTR", meter: "MTR", cm: "CMT", mm: "MMT",
  "m²": "MTK", qm: "MTK", "m³": "MTQ",
  set: "SET", paar: "PR", paket: "XPK", karton: "CT", palette: "XP",
  dose: "TN", flasche: "BO", tube: "TU",
};

function einheitCode(einheit: string): string {
  return EINHEIT_CODES[einheit.trim().toLowerCase()] ?? "C62";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JJJJ-MM-TT → JJJJMMTT (Format 102) */
function datum102(iso: string): string {
  return iso.replaceAll("-", "");
}

/** Dezimal mit Punkt und 2 Nachkommastellen */
function betrag(cent: number): string {
  return (cent / 100).toFixed(2);
}

function preisStr(dezimal: string): string {
  return Number(dezimal).toFixed(2);
}

/** ISO-Ländercode aus Landnamen (XRechnung verlangt Alpha-2) */
const LAENDER: Record<string, string> = {
  deutschland: "DE", germany: "DE", österreich: "AT", austria: "AT",
  schweiz: "CH", switzerland: "CH", frankreich: "FR", niederlande: "NL",
  belgien: "BE", italien: "IT", spanien: "ES", polen: "PL",
};

function landCode(land: string): string {
  const l = land.trim();
  if (/^[A-Z]{2}$/.test(l)) return l;
  return LAENDER[l.toLowerCase()] ?? "DE";
}

export function erzeugeXrechnung(e: XrechnungEingabe): string {
  if (!e.firma.email) {
    throw new Error("XRechnung benötigt eine Firmen-E-Mail (BT-34) — bitte in den Einstellungen hinterlegen.");
  }
  if (!e.kunde.email) {
    throw new Error(`XRechnung benötigt eine E-Mail-Adresse des Käufers (BT-49) — bitte beim Kunden „${e.kunde.name}“ hinterlegen.`);
  }
  if (!e.firma.ustIdNr && !e.firma.steuernummer) {
    throw new Error("XRechnung benötigt USt-IdNr. oder Steuernummer des Verkäufers — bitte in den Einstellungen hinterlegen.");
  }
  if (!e.firma.ustIdNr && !e.firma.handelsregister) {
    throw new Error(
      "XRechnung (BR-CO-26) benötigt die USt-IdNr. oder das Handelsregister des Verkäufers — bitte in den Einstellungen hinterlegen.",
    );
  }

  const totals = computeTotals(
    e.items.map((it) => ({
      einzelpreis: it.einzelpreis,
      menge: it.menge,
      ustSatz: it.ustSatz,
    })),
  );

  const zeilenXml = e.items
    .map((it, i) => {
      const kat = it.ustSatz === 0 ? "E" : "S";
      return `    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>${i + 1}</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${esc(it.bezeichnung)}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>${preisStr(it.einzelpreis)}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${einheitCode(it.einheit)}">${it.menge}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${kat}</ram:CategoryCode>
          <ram:RateApplicablePercent>${it.ustSatz}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${betrag(totals.zeilenNettoCent[i])}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
    })
    .join("\n");

  const steuerXml = totals.ustProSatz
    .map((u) => {
      const kat = u.satz === 0 ? "E" : "S";
      return `      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${betrag(u.betragCent)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${betrag(u.basisCent)}</ram:BasisAmount>
        <ram:CategoryCode>${kat}</ram:CategoryCode>
        <ram:RateApplicablePercent>${u.satz}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
    })
    .join("\n");

  const steuerReg = e.firma.ustIdNr
    ? `<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">${esc(e.firma.ustIdNr.replace(/\s/g, ""))}</ram:ID>
        </ram:SpecifiedTaxRegistration>`
    : `<ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="FC">${esc((e.firma.steuernummer ?? "").replace(/[^\dA-Za-z]/g, ""))}</ram:ID>
        </ram:SpecifiedTaxRegistration>`;

  // BG-6: Verkaeufer-Ansprechpartner (XRechnung-Pflicht, BR-DE-2)
  const kontaktXml = `        <ram:DefinedTradeContact>
          <ram:PersonName>${esc(e.firma.name)}</ram:PersonName>${
    e.firma.telefon
      ? `
          <ram:TelephoneUniversalCommunication>
            <ram:CompleteNumber>${esc(e.firma.telefon)}</ram:CompleteNumber>
          </ram:TelephoneUniversalCommunication>`
      : ""
  }
          <ram:EmailURIUniversalCommunication>
            <ram:URIID>${esc(e.firma.email!)}</ram:URIID>
          </ram:EmailURIUniversalCommunication>
        </ram:DefinedTradeContact>`;

  // BT-30: Handelsregister (Alternative zur USt-IdNr. fuer BR-CO-26)
  const legalXml = e.firma.handelsregister
    ? `        <ram:SpecifiedLegalOrganization>
          <ram:ID>${esc(e.firma.handelsregister)}</ram:ID>
        </ram:SpecifiedLegalOrganization>
`
    : "";

  const zahlungXml = e.bank
    ? `      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>${esc(e.bank.iban.replace(/\s/g, ""))}</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>`
    : "";

  const faelligXml = e.faelligkeitsdatum
    ? `      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">${datum102(e.faelligkeitsdatum)}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>`
    : "";

  const lieferXml = e.leistungsdatum
    ? `    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
          <udt:DateTimeString format="102">${datum102(e.leistungsdatum)}</udt:DateTimeString>
        </ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>`
    : "    <ram:ApplicableHeaderTradeDelivery/>";

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter>
      <ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
    </ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${esc(e.nummer)}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">${datum102(e.rechnungsdatum)}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
${zeilenXml}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>${esc(e.nummer)}</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>${esc(e.firma.name)}</ram:Name>
${legalXml}${kontaktXml}
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${esc(e.firma.plz)}</ram:PostcodeCode>
          <ram:LineOne>${esc(e.firma.strasse)}</ram:LineOne>
          <ram:CityName>${esc(e.firma.ort)}</ram:CityName>
          <ram:CountryID>${landCode(e.firma.land)}</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="EM">${esc(e.firma.email)}</ram:URIID>
        </ram:URIUniversalCommunication>
        ${steuerReg}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${esc(e.kunde.name)}</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>${esc(e.kunde.plz)}</ram:PostcodeCode>
          <ram:LineOne>${esc(e.kunde.strasse)}</ram:LineOne>
          <ram:CityName>${esc(e.kunde.ort)}</ram:CityName>
          <ram:CountryID>${landCode(e.kunde.land)}</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:URIUniversalCommunication>
          <ram:URIID schemeID="EM">${esc(e.kunde.email)}</ram:URIID>
        </ram:URIUniversalCommunication>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
${lieferXml}
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
${zahlungXml}
${steuerXml}
${faelligXml}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${betrag(totals.nettoCent)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${betrag(totals.nettoCent)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${betrag(totals.ustCent)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${betrag(totals.bruttoCent)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${betrag(totals.bruttoCent)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}
