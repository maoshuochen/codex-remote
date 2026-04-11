export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
};

export type JsonRpcSuccess = {
  jsonrpc: "2.0";
  id: string;
  result: unknown;
};

export type JsonRpcError = {
  jsonrpc: "2.0";
  id: string | null;
  error: {
    code: number;
    message: string;
  };
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type CodexThread = {
  id: string;
  preview: string;
  updatedAt: number;
  status:
    | string
    | {
        type?: string;
        [key: string]: unknown;
      };
  cwd: string;
  name: string | null;
  turns: Array<{
    id: string;
    items: Array<
      | {
          type: "userMessage";
          id: string;
          content: Array<{ type: string; text?: string }>;
        }
      | {
          type: "agentMessage";
          id: string;
          text: string;
        }
      | {
          type: string;
          id: string;
        }
    >;
  }>;
};
