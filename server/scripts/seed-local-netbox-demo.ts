import axios, { AxiosError, type AxiosInstance } from "axios";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type NetBoxObject = {
  id: number;
  name?: string;
  slug?: string;
};

type NetBoxListResponse<T> = {
  count: number;
  next: string | null;
  results: T[];
};

const envPath = resolve(process.cwd(), ".env.netbox");

function readLocalEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const content = readFileSync(envPath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    env[key] = value;
  }

  return env;
}

function requireEnv(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`${key} is required in .env.netbox`);
  }
  return value;
}

function authHeaderFor(token: string): string {
  return token.includes(".") ? `Bearer ${token}` : `Token ${token}`;
}

function sanitizeApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const statusText = axiosError.response?.statusText;

    if (status) {
      return `NetBox API returned ${status}${statusText ? ` ${statusText}` : ""}`;
    }
  }

  if (error instanceof Error) {
    return error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/Token\s+\S+/gi, "Token [redacted]");
  }

  return "Unknown NetBox API error";
}

async function getOrCreate<T extends NetBoxObject>(
  client: AxiosInstance,
  listPath: string,
  query: Record<string, string>,
  createPath: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const existing = await client.get<NetBoxListResponse<T>>(listPath, { params: query });
  if (existing.data.count > 0) {
    return existing.data.results[0];
  }

  const created = await client.post<T>(createPath, payload);
  return created.data;
}

async function countDemoVms(client: AxiosInstance): Promise<number> {
  let total = 0;
  let next: string | null = "/virtualization/virtual-machines/";

  while (next) {
    const response: { data: NetBoxListResponse<NetBoxObject> } = await client.get<NetBoxListResponse<NetBoxObject>>(next, {
      params: next === "/virtualization/virtual-machines/" ? { name__ic: "demo-vm-" } : undefined,
    });

    total += response.data.results.filter((vm: NetBoxObject) => /^demo-vm-\d{3}$/.test(vm.name ?? "")).length;
    next = response.data.next;
  }

  return total;
}

async function main() {
  const env = readLocalEnv();
  const netboxUrl = requireEnv(env, "NETBOX_URL").replace(/\/+$/, "");
  const netboxToken = requireEnv(env, "NETBOX_TOKEN");

  const client = axios.create({
    baseURL: `${netboxUrl}/api`,
    headers: {
      Authorization: authHeaderFor(netboxToken),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    timeout: 30_000,
  });

  let createdCount = 0;
  let existingCount = 0;

  try {
    const site = await getOrCreate<NetBoxObject>(
      client,
      "/dcim/sites/",
      { slug: "rovelink-lab" },
      "/dcim/sites/",
      { name: "rovelink-lab", slug: "rovelink-lab", status: "active" },
    );

    const clusterType = await getOrCreate<NetBoxObject>(
      client,
      "/virtualization/cluster-types/",
      { slug: "docker-lab" },
      "/virtualization/cluster-types/",
      { name: "docker-lab", slug: "docker-lab" },
    );

    const cluster = await getOrCreate<NetBoxObject>(
      client,
      "/virtualization/clusters/",
      { name: "local-netbox-lab" },
      "/virtualization/clusters/",
      { name: "local-netbox-lab", type: clusterType.id, site: site.id },
    );

    for (let index = 1; index <= 20; index += 1) {
      const name = `demo-vm-${String(index).padStart(3, "0")}`;
      const existing = await client.get<NetBoxListResponse<NetBoxObject>>("/virtualization/virtual-machines/", {
        params: { name },
      });

      if (existing.data.count > 0) {
        existingCount += 1;
        continue;
      }

      await client.post("/virtualization/virtual-machines/", {
        name,
        status: "active",
        cluster: cluster.id,
      });
      createdCount += 1;
    }

    const totalCount = await countDemoVms(client);

    console.log(`created count: ${createdCount}`);
    console.log(`existing count: ${existingCount}`);
    console.log(`total demo VM count: ${totalCount}`);
  } catch (error) {
    console.log(`created count: ${createdCount}`);
    console.log(`existing count: ${existingCount}`);
    console.log("total demo VM count: 0");
    console.log(`API error: ${sanitizeApiError(error)}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.log("created count: 0");
  console.log("existing count: 0");
  console.log("total demo VM count: 0");
  console.log(`API error: ${sanitizeApiError(error)}`);
  process.exitCode = 1;
});
