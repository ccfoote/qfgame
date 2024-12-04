import { ORTool } from "./openRouterTypes";

export type ToolItem = {
  serial?: boolean;
  function: (
    args: any,
    onLogMessage: (title: string, message: string) => void,
    o: {
      modelName: string;
      openRouterKey: string | null;
    },
  ) => Promise<any>;
  detailedDescription?: string;
  tool: ORTool;
};
