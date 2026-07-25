// ── DATEV-Export: Buchungsstapel (EXTF, Version 700) ────────────────────────
// Rechnungsausgang: Soll Debitor (brutto) an Erlöskonto (brutto, BU-Schlüssel
// 3 = 19 %, 2 = 7 % → DATEV-Umsatzsteuerautomatik splittet Netto/Steuer).
// Gutschriften: gleiche Konten, S/H = "H".

export interface DatevEinstellungen {
  beraternummer: string;
  mandantennummer: string;
  kontenrahmen: string; // "SKR03" | "SKR04"
  erloeskonto19: string;
  erloeskonto7: string;
  erloeskonto0: string;
}

export interface DatevBuchung {
  debitornummer: number;
  belegdatum: string; // JJJJ-MM-TT
  belegfeld1: string; // Belegnummer
  buchungstext: string;
  /** Brutto-Anteil dieses Steuersatzes in Cent, negativ bei Gutschrift */
  betragCent: number;
  ustSatz: number;
}

function feld(v: string): string {
  // DATEV-Textfelder in Anführungszeichen; leere Felder unquotiert
  if (v === "") return "";
  return `"${v.replace(/"/g, '""')}"`;
}

function zahl(cent: number): string {
  return (Math.abs(cent) / 100).toFixed(2).replace(".", ",");
}

function datum102(iso: string): string {
  return iso.replaceAll("-", "");
}

function datumTTMM(iso: string): string {
  const [, m, t] = iso.split("-");
  return `${t}${m}`;
}

// Spaltenköpfe Zeile 2 (Buchungsstapel, Formatversion 11 — stabil und weit verbreitet)
const SPALTEN =
  'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext;Postensperre;Diverse Adressnummer;Geschäftspartnerbank;Sachverhalt;Zinssperre;Beleglink;Beleginfo - Art 1;Beleginfo - Inhalt 1;Beleginfo - Art 2;Beleginfo - Inhalt 2;Beleginfo - Art 3;Beleginfo - Inhalt 3;Beleginfo - Art 4;Beleginfo - Inhalt 4;Beleginfo - Art 5;Beleginfo - Inhalt 5;Beleginfo - Art 6;Beleginfo - Inhalt 6;Beleginfo - Art 7;Beleginfo - Inhalt 7;Beleginfo - Art 8;Beleginfo - Inhalt 8;KOST1 - Kostenstelle;KOST2 - Kostenstelle;Kost-Menge;EU-Land u. UStID;EU-Steuersatz;Abw. Versteuerungsart;Sachverhalt L+L;Funktionsergänzung L+L;BU 49 Hauptfunktionstyp;BU 49 Hauptfunktionsnummer;BU 49 Funktionsergänzung;Zusatzinformation - Art 1;Zusatzinformation- Inhalt 1;Zusatzinformation - Art 2;Zusatzinformation- Inhalt 2;Zusatzinformation - Art 3;Zusatzinformation- Inhalt 3;Zusatzinformation - Art 4;Zusatzinformation- Inhalt 4;Zusatzinformation - Art 5;Zusatzinformation- Inhalt 5;Zusatzinformation - Art 6;Zusatzinformation- Inhalt 6;Zusatzinformation - Art 7;Zusatzinformation- Inhalt 7;Zusatzinformation - Art 8;Zusatzinformation- Inhalt 8;Zusatzinformation - Art 9;Zusatzinformation- Inhalt 9;Zusatzinformation - Art 10;Zusatzinformation- Inhalt 10;Zusatzinformation - Art 11;Zusatzinformation- Inhalt 11;Zusatzinformation - Art 12;Zusatzinformation- Inhalt 12;Zusatzinformation - Art 13;Zusatzinformation- Inhalt 13;Zusatzinformation - Art 14;Zusatzinformation- Inhalt 14;Zusatzinformation - Art 15;Zusatzinformation- Inhalt 15;Zusatzinformation - Art 16;Zusatzinformation- Inhalt 16;Zusatzinformation - Art 17;Zusatzinformation- Inhalt 17;Zusatzinformation - Art 18;Zusatzinformation- Inhalt 18;Zusatzinformation - Art 19;Zusatzinformation- Inhalt 19;Zusatzinformation - Art 20;Zusatzinformation- Inhalt 20;Stück;Gewicht;Zahlweise;Forderungsart;Veranlagungsjahr;Zugeordnete Fälligkeit;Skontotyp;Auftragsnummer;Buchungstyp (Anzahlungen);USt-Schlüssel (Anzahlungen);EU-Land (Anzahlungen);Sachverhalt L+L (Anzahlungen);EU-Steuersatz (Anzahlungen);Erlöskonto (Anzahlungen);Herkunft-Kz;Buchungs GUID;KOST-Datum;SEPA-Mandatsreferenz;Skontosperre;Gesellschaftername;Beteiligtennummer;Identifikationsnummer;Zeichnernummer;Postensperre bis;Bezeichnung SoBil-Sachverhalt;Kennzeichen SoBil-Buchung;Festschreibung;Leistungsdatum;Datum Zuord. Steuerperiode;Fälligkeit;Generalumkehr (GU);Steuersatz;Land;Abrechnungsreferenz;BVV-Position';

const SPALTEN_ANZAHL = SPALTEN.split(";").length;

export function erzeugeBuchungsstapel(
  einst: DatevEinstellungen,
  von: string,
  bis: string,
  buchungen: DatevBuchung[],
): string {
  const jetzt = new Date();
  const erzeugtAm =
    jetzt.getFullYear().toString() +
    String(jetzt.getMonth() + 1).padStart(2, "0") +
    String(jetzt.getDate()).padStart(2, "0") +
    String(jetzt.getHours()).padStart(2, "0") +
    String(jetzt.getMinutes()).padStart(2, "0") +
    String(jetzt.getSeconds()).padStart(2, "0") +
    "000";
  const wjBeginn = `${von.slice(0, 4)}0101`;
  const rahmen = einst.kontenrahmen === "SKR04" ? "04" : "03";

  const header = [
    feld("EXTF"),
    "700",
    "21",
    feld("Buchungsstapel"),
    "11",
    erzeugtAm,
    "", // Importiert
    feld("RE"),
    feld("WAWIPROS"),
    "", // Importiert von
    einst.beraternummer || "1",
    einst.mandantennummer || "1",
    wjBeginn,
    "4",
    datum102(von),
    datum102(bis),
    feld(`Rechnungsausgang ${datum102(von)}-${datum102(bis)}`),
    feld("RE"),
    "1", // Buchungstyp: Finanzbuchführung
    "0", // Rechnungslegungszweck
    "0", // Festschreibung
    feld("EUR"),
    "", "", "", "",
    rahmen, // Sachkontenrahmen
    "", "", "",
  ].join(";");

  const zeilen = buchungen.map((b) => {
    const konto =
      b.ustSatz === 19 ? einst.erloeskonto19 : b.ustSatz === 7 ? einst.erloeskonto7 : einst.erloeskonto0;
    const bu = b.ustSatz === 19 ? "3" : b.ustSatz === 7 ? "2" : "";
    const sh = b.betragCent >= 0 ? "S" : "H";
    const basis = [
      zahl(b.betragCent),
      feld(sh),
      feld("EUR"),
      "", // Kurs
      "", // Basis-Umsatz
      "", // WKZ Basis
      String(b.debitornummer),
      konto,
      bu,
      datumTTMM(b.belegdatum),
      feld(b.belegfeld1.slice(0, 36)),
      "", // Belegfeld 2
      "", // Skonto
      feld(b.buchungstext.slice(0, 60)),
    ];
    while (basis.length < SPALTEN_ANZAHL) basis.push("");
    return basis.join(";");
  });

  return [header, SPALTEN, ...zeilen].join("\r\n") + "\r\n";
}
