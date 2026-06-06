export type Request = {
  id: string;
  cmd: string;
  args?: unknown[];
  opts?: object;
};

export type Response = {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};
