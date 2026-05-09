'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface TrazabilidadRow {
  lead_id: string;
  "Fecha del Lead": string;
  "Cita Valoración": string | null;
  "Cita Posterior": string | null;
  Fuente: string | null;
  Estado: string | null;
  Revenue: number | null;
  "Fecha Conversión": string | null;
}

interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

export default function TrazabilidadFunnelTable() {
  const [data, setData] = useState<TrazabilidadRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [leadRange, setLeadRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [valoracionRange, setValoracionRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [posteriorRange, setPosteriorRange] = useState<DateRange>({ from: undefined, to: undefined });

  const fetchData = async () => {
    setLoading(true);
    try {
      const filters = {
        leadFrom: leadRange.from ? format(leadRange.from, 'yyyy-MM-dd') : '',
        leadTo: leadRange.to ? format(leadRange.to, 'yyyy-MM-dd') : '',
        valoracionFrom: valoracionRange.from ? format(valoracionRange.from, 'yyyy-MM-dd') : '',
        valoracionTo: valoracionRange.to ? format(valoracionRange.to, 'yyyy-MM-dd') : '',
        posteriorFrom: posteriorRange.from ? format(posteriorRange.from, 'yyyy-MM-dd') : '',
        posteriorTo: posteriorRange.to ? format(posteriorRange.to, 'yyyy-MM-dd') : '',
      };

      const res = await fetch('/api/trazabilidad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });

      const result = await res.json();
      setData(result.data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const clearAllFilters = () => {
    setLeadRange({ from: undefined, to: undefined });
    setValoracionRange({ from: undefined, to: undefined });
    setPosteriorRange({ from: undefined, to: undefined });
    fetchData();
  };

  useEffect(() => {
    fetchData();
  }, []);

  const DatePicker = ({
    label,
    range,
    onChange,
  }: {
    label: string;
    range: DateRange;
    onChange: (range: DateRange) => void;
  }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !range.from && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {range.from ? (
              range.to ? (
                `${format(range.from, 'dd/MM/yyyy')} - ${format(range.to, 'dd/MM/yyyy')}`
              ) : (
                format(range.from, 'dd/MM/yyyy')
              )
            ) : (
              "Seleccionar rango"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={range}
            onSelect={onChange}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold">Trazabilidad - Funnel Real</h2>
            <p className="text-sm text-gray-500 mt-1">
              Solo leads de adquisición • Excluye Doctoralia como fuente
            </p>
          </div>
          <div className="flex gap-3">
            <Button onClick={fetchData} disabled={loading}>
              {loading ? 'Actualizando...' : 'Aplicar Filtros'}
            </Button>
            <Button variant="outline" onClick={clearAllFilters}>
              <X className="mr-2 h-4 w-4" /> Limpiar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <DatePicker label="Fecha del Lead" range={leadRange} onChange={setLeadRange} />
          <DatePicker label="Cita Valoración" range={valoracionRange} onChange={setValoracionRange} />
          <DatePicker label="Cita Posterior" range={posteriorRange} onChange={setPosteriorRange} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="px-6 py-4 text-left font-medium">Fecha del Lead</th>
                <th className="px-6 py-4 text-left font-medium">Cita Valoración</th>
                <th className="px-6 py-4 text-left font-medium">Cita Posterior</th>
                <th className="px-6 py-4 text-left font-medium">Fuente</th>
                <th className="px-6 py-4 text-left font-medium">Estado</th>
                <th className="px-6 py-4 text-right font-medium">Revenue</th>
                <th className="px-6 py-4 text-left font-medium">Conversión</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
                      <p className="text-gray-500">Cargando trazabilidad...</p>
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-20 text-center text-gray-500">
                    No se encontraron registros con los filtros aplicados
                  </td>
                </tr>
              ) : (
                data.map((row, index) => (
                  <tr key={index} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-medium">{row["Fecha del Lead"]}</td>
                    <td className="px-6 py-4 text-emerald-600 font-medium">
                      {row["Cita Valoración"] || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4 text-purple-600 font-medium">
                      {row["Cita Posterior"] || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-6 py-4">{row.Fuente || "—"}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {row.Estado || "Sin estado"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-semibold">
                      {row.Revenue ? `€${row.Revenue.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {row["Fecha Conversión"] || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between text-sm text-gray-500">
          <div>Total registros: <span className="font-semibold text-gray-900">{data.length}</span></div>
          <div className="text-xs">Funnel real • Solo leads de adquisición</div>
        </div>
      </div>
    </div>
  );
}