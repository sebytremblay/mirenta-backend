import Anthropic from "@anthropic-ai/sdk";
import { config } from "../src/config/env.ts";
import { RESEARCH_TOOL_SCHEMA } from "../src/domain/research.ts";
import { buildAgentSystemPrompt, EMIT_RESEARCH_TOOL } from "../src/agents/research.ts";

const client = new Anthropic({
  apiKey: config.anthropic.apiKey,
  baseURL: config.anthropic.baseUrl,
  maxRetries: 3,
});

const EXA_MCP_URL = config.managedAgents.exaMcpUrl;

type AgentBody = {
  name: string;
  model: string;
  system: string;
  mcp_servers: Anthropic.Beta.Agents.AgentCreateParams["mcp_servers"];
  tools: Anthropic.Beta.Agents.AgentCreateParams["tools"];
};

function agentConfig(): AgentBody {
  return {
    name: "mirenta-research-agent",
    model: config.anthropic.researchModel,
    system: buildAgentSystemPrompt(),
    mcp_servers: [{ type: "url", name: "exa", url: EXA_MCP_URL }],
    tools: [
      {
        type: "mcp_toolset",
        mcp_server_name: "exa",
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
      },
      {
        type: "custom",
        name: EMIT_RESEARCH_TOOL,
        description:
          "Emit the final structured research object. Call exactly once when all four phases finish.",
        input_schema:
          RESEARCH_TOOL_SCHEMA as unknown as Anthropic.Beta.Agents.BetaManagedAgentsCustomToolInputSchema,
      },
    ],
  };
}

async function teardown() {
  const { environmentId, researchAgentId, exaVaultId } = config.managedAgents;
  if (researchAgentId) {
    try {
      await client.beta.agents.archive(researchAgentId);
      console.log("archived agent ", researchAgentId);
    } catch (e) {
      console.log("agent archive failed:", (e as Error).message);
    }
  }
  if (environmentId) {
    try {
      await client.beta.environments.delete(environmentId);
      console.log("deleted env   ", environmentId);
    } catch (e) {
      console.log("env delete failed:", (e as Error).message);
    }
  }
  if (exaVaultId) {
    try {
      await client.beta.vaults.delete(exaVaultId);
      console.log("deleted vault ", exaVaultId);
    } catch (e) {
      console.log("vault delete failed:", (e as Error).message);
    }
  }
}

async function provision() {
  let environmentId = config.managedAgents.environmentId;
  if (environmentId) {
    console.log("env (reused) ", environmentId);
  } else {
    const env = await client.beta.environments.create({
      name: "mirenta-research-env",
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    environmentId = env.id;
    console.log("env (created)", environmentId);
  }

  let exaVaultId = config.managedAgents.exaVaultId;
  if (exaVaultId) {
    console.log("vault (reused)", exaVaultId);
  } else {
    const vault = await client.beta.vaults.create({ display_name: "mirenta-exa" });
    exaVaultId = vault.id;
    await client.beta.vaults.credentials.create(exaVaultId, {
      display_name: "Exa MCP",
      auth: {
        type: "static_bearer",
        mcp_server_url: EXA_MCP_URL,
        token: config.exa.apiKey,
      },
    });
    console.log("vault (created)", exaVaultId);
  }

  const cfg = agentConfig();
  let researchAgentId = config.managedAgents.researchAgentId;
  if (researchAgentId) {
    // Update requires the current version to guard against concurrent overwrites.
    const current = await client.beta.agents.retrieve(researchAgentId);
    const updated = await client.beta.agents.update(researchAgentId, {
      ...cfg,
      version: current.version,
    });
    console.log("agent (updated)", researchAgentId, "version", updated.version);
  } else {
    const agent = await client.beta.agents.create(cfg);
    researchAgentId = agent.id;
    console.log("agent (created)", researchAgentId, "version", agent.version);
  }

  console.log("\nPaste these into mirenta-backend/.env:\n");
  console.log(`ANTHROPIC_ENVIRONMENT_ID=${environmentId}`);
  console.log(`ANTHROPIC_RESEARCH_AGENT_ID=${researchAgentId}`);
  console.log(`ANTHROPIC_EXA_VAULT_ID=${exaVaultId}`);
}

const mode = process.argv.includes("--teardown") ? "teardown" : "provision";
try {
  if (mode === "teardown") {
    await teardown();
    console.log("teardown complete");
  } else {
    await provision();
  }
} catch (e) {
  console.error("PROVISION FAILED:", (e as Error).message);
  process.exitCode = 1;
}
