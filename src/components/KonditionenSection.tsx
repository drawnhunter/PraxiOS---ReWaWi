import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { geld, parseGeldInput } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

// Sonderpreise eines Kunden (VK) bzw. Lieferanten (EK) pro Produkt
export function KonditionenSection({
  typ,
  partnerId,
}: {
  typ: "kunde" | "lieferant";
  partnerId: number;
}) {
  const utils = trpc.useUtils();
  const liste = trpc.products.konditionenListe.useQuery({ typ, partnerId });
  const produkte = trpc.products.list.useQuery();

  const [productId, setProductId] = useState("");
  const [preis, setPreis] = useState("");

  const invalid = () => utils.products.konditionenListe.invalidate({ typ, partnerId });

  const setzen = trpc.products.konditionSetzen.useMutation({
    onSuccess: () => {
      invalid();
      setProductId("");
      setPreis("");
    },
  });
  const loeschen = trpc.products.konditionLoeschen.useMutation({
    onSuccess: invalid,
  });

  const art = typ === "kunde" ? "VK" : "EK";

  return (
    <div className="mt-4 rounded-md border border-neutral-200 p-3">
      <div className="mb-1 text-sm font-medium text-neutral-700">
        Konditionen (Sonderpreise)
      </div>
      <p className="mb-3 text-xs text-neutral-400">
        Abweichender {art}-Preis pro Produkt — wird in Belegen automatisch
        statt des Standardpreises gezogen.
      </p>

      {(liste.data ?? []).length > 0 && (
        <table className="mb-3 w-full text-sm">
          <tbody>
            {(liste.data ?? []).map((k) => (
              <tr key={k.id} className="border-b border-neutral-100 last:border-0">
                <td className="py-1.5 pr-2">{k.produktName}</td>
                <td className="py-1.5 pr-2 text-right text-neutral-500">{k.einheit}</td>
                <td className="py-1.5 pr-2 text-right font-medium">{geld(k.preisNetto)}</td>
                <td className="py-1.5 w-8 text-right">
                  <button
                    type="button"
                    onClick={() => loeschen.mutate({ id: k.id })}
                    className="rounded p-1 text-neutral-400 hover:text-red-600"
                    title="Kondition löschen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Label className="text-xs">Produkt</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger>
              <SelectValue placeholder="wählen …" />
            </SelectTrigger>
            <SelectContent>
              {(produkte.data ?? []).map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-28">
          <Label className="text-xs">{art} netto</Label>
          <Input
            value={preis}
            onChange={(e) => setPreis(e.target.value)}
            placeholder="0,00"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!productId || !preis || setzen.isPending}
          onClick={() =>
            setzen.mutate({
              typ,
              partnerId,
              productId: Number(productId),
              preisNetto: parseGeldInput(preis),
            })
          }
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {setzen.error && (
        <p className="mt-2 text-xs text-red-600">{setzen.error.message}</p>
      )}
    </div>
  );
}
