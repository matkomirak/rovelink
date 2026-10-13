import type { AzureDiscoveryResult } from "./azure";

// Fictional runtime inventory only. No clients, credentials, or external writes.
export function generateFakeAzureDiscovery(): AzureDiscoveryResult[] {
  return [1, 2].map((subscription) => {
    const subscriptionId = `00000000-0000-0000-0000-00000000000${subscription}`;
    const customer = subscription === 1 ? "acme" : "contoso";
    const resourceGroup = `rg-${customer}-prod`;
    const root = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers`;
    const vnetName = `vnet-${customer}-prod`;
    const vnetId = `${root}/Microsoft.Network/virtualNetworks/${vnetName}`;
    const names = subscription === 1 ? ["acme-web-01", "acme-db-01"] : ["contoso-app-01", "orphan-runtime-01"];
    const tags: Record<string, string> = subscription === 1
      ? { customer: "ACME", customerScope: "ACME", environment: "prod", costCenter: "demo" }
      : { tenant: "contoso", environment: "prod", costCenter: "demo" };
    const vms: AzureDiscoveryResult["vms"] = names.map((name, index) => {
      const id = `${root}/Microsoft.Compute/virtualMachines/${name}`;
      const privateIp = `10.${subscription === 1 ? 42 : 43}.${index}.4`;
      const nic = {
        id: `${root}/Microsoft.Network/networkInterfaces/${name}-nic`,
        name: `${name}-nic`, resourceGroup, vmId: id, vmName: name,
        privateIps: [privateIp], publicIps: name === "acme-web-01" ? ["192.0.2.10"] : [],
        subnetName: subscription === 1 ? (index === 0 ? "subnet-web" : "subnet-db") : "subnet-app",
        virtualNetworkName: vnetName, primary: true,
      };
      return {
        id, name, subscriptionId, resourceGroup, location: "westeurope",
        vmSize: index === 0 ? "Standard_D2s_v5" : "Standard_D4s_v5",
        status: name === "acme-db-01" ? "stopped" : "running", platform: "linux",
        computerName: name, vcpus: index === 0 ? 2 : 4, ramGiB: index === 0 ? 8 : 16,
        disk: 128, primaryIp4: privateIp, nics: [nic],
        tags: name === "orphan-runtime-01" ? { costCenter: "demo" } : tags,
      };
    });
    return {
      subscriptionId, vms, nics: vms.flatMap(vm => vm.nics),
      vnets: [{ id: vnetId, name: vnetName, resourceGroup, location: "westeurope", tags,
        addressSpaces: [`10.${subscription === 1 ? 42 : 43}.0.0/16`],
        subnets: (subscription === 1 ? ["subnet-web", "subnet-db"] : ["subnet-app"]).map((name, index) => ({
          id: `${vnetId}/subnets/${name}`, name, resourceGroup, virtualNetworkName: vnetName,
          addressPrefix: `10.${subscription === 1 ? 42 : 43}.${index}.0/24`,
        })),
      }],
      publicIps: subscription === 1 ? [{
        id: `${root}/Microsoft.Network/publicIPAddresses/acme-web-01-pip`,
        name: "acme-web-01-pip", resourceGroup, location: "westeurope", ipAddress: "192.0.2.10",
        ipVersion: "IPv4", associatedNicId: vms[0].nics[0].id, tags,
      }] : [],
    };
  });
}
