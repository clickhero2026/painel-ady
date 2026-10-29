import { campo, rotulo } from "./estilos";

/** Lista de opções com rótulo, para formulários GET de filtro. "Todos" = sem filtro. */
export function Seletor(props: {
  id: string;
  rotulo: string;
  valor: string | undefined;
  opcoes: [string, string][];
  vazio?: boolean;
}) {
  return (
    <div>
      <label htmlFor={props.id} className={rotulo}>
        {props.rotulo}
      </label>
      <select id={props.id} name={props.id} defaultValue={props.valor ?? ""} className={campo}>
        {props.vazio !== false && <option value="">Todos</option>}
        {props.opcoes.map(([valor, texto]) => (
          <option key={valor} value={valor}>
            {texto}
          </option>
        ))}
      </select>
    </div>
  );
}
