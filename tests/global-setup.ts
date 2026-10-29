import { recriarBanco } from "./banco";

export default async function setup() {
  await recriarBanco();
}
