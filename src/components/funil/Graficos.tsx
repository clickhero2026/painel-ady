"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatarDia, formatarNumero } from "@/lib/formatos";

/**
 * Gráficos do funil (Recharts). Só rodam no navegador (ver
 * GraficosCarregados.tsx). Cada um é uma imagem com descrição em texto
 * (role="img"); os números completos ficam na tabela ao lado, que é a
 * alternativa acessível. Cores do tema: barras em petróleo forte (5,4:1
 * sobre branco), texto dos eixos no cinza do texto secundário.
 */

const COR_BARRA = "#17708a";
const COR_TEXTO = "#45525a";
const COR_GRADE = "#d3e2e8";
const FONTE = { fill: COR_TEXTO, fontSize: 13 };

export interface EtapaDoGrafico {
  etapa: string;
  total: number;
}

export function GraficoFunil({ etapas, descricao }: { etapas: EtapaDoGrafico[]; descricao: string }) {
  return (
    <div role="img" aria-label={descricao} className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={etapas} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} accessibilityLayer={false}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="etapa" width={112} tick={FONTE} tickLine={false} axisLine={false} />
          <Bar dataKey="total" fill={COR_BARRA} radius={[0, 4, 4, 0]} isAnimationActive={false} minPointSize={2}>
            <LabelList
              dataKey="total"
              position="right"
              formatter={(v) => formatarNumero(Number(v))}
              style={{ fill: "#0c0d0a", fontSize: 13, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DiaDoGrafico {
  dia: string;
  cadastros: number;
}

export function GraficoSerie({ dias, descricao }: { dias: DiaDoGrafico[]; descricao: string }) {
  return (
    <div role="img" aria-label={descricao} className="h-60 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dias} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke={COR_GRADE} />
          <XAxis
            dataKey="dia"
            tickFormatter={(d: string) => formatarDia(d, true)}
            tick={FONTE}
            tickLine={false}
            axisLine={{ stroke: COR_GRADE }}
            minTickGap={16}
          />
          <YAxis allowDecimals={false} width={36} tick={FONTE} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: "#e3f1f6" }}
            labelFormatter={(d) => formatarDia(String(d))}
            formatter={(v) => [formatarNumero(Number(v)), "Cadastros"]}
          />
          <Bar dataKey="cadastros" name="Cadastros" fill={COR_BARRA} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
