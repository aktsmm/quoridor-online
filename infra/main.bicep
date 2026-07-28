// Workload infrastructure for Quoridor Online.
//
// Deployed manually, once, and then only when the shape of the infrastructure
// changes. The deploy workflows never touch this file: `deploy-server.yml`
// only swaps the container image, and `deploy-web.yml` only uploads the built
// front end.
//
//   az deployment group create -g rg-quoridor-online -f infra/main.bicep \
//     -p containerImage=ghcr.io/aktsmm/quoridor-online/server:<sha> \
//        deployIdentityPrincipalId=<principalId of id-quoridor-deploy>
//
// Cost: everything here sits inside a free tier except the storage account,
// which holds a few KB of room snapshots.

targetScope = 'resourceGroup'

@description('Region for everything except the Static Web App.')
param location string = resourceGroup().location

@description('Static Web Apps has no japaneast region, so the front end lives in eastasia.')
param staticSiteLocation string = 'eastasia'

@description('Fully qualified image the container app should run.')
param containerImage string

@description('''
Principal ID of the `id-quoridor-deploy` user-assigned identity created by
bootstrap.bicep. The role assignments below are what let GitHub Actions swap
the image and publish the front end without any stored secret.
''')
param deployIdentityPrincipalId string

@description('Storage account holding the room snapshot tables. Must be globally unique.')
param storageAccountName string = 'stquoridor177027'

@description('Seconds a disconnected player keeps their seat before the CPU takes over.')
param reconnectGraceMs int = 60000

// Built-in roles, referenced by ID so the template does not depend on display names.
var contributorRoleId = 'b24988ac-6180-42a0-ab88-20f7382dd24c'
var tableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-quoridor'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    // The server authenticates with its managed identity; shared keys exist only
    // because the Table service still advertises them.
    defaultToOAuthAuthentication: true
  }
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource roomsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tables
  name: 'rooms'
}

resource codesTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tables
  name: 'roomcodes'
}

resource site 'Microsoft.Web/staticSites@2023-01-01' = {
  name: 'swa-quoridor'
  location: staticSiteLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // The build is uploaded by GitHub Actions rather than by the Static Web
    // Apps build service, so no repository is linked here.
    stagingEnvironmentPolicy: 'Disabled'
    allowConfigFileUpdates: true
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-quoridor'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    // Consumption-only environment: no workload profiles, which is what keeps
    // the per-second billing (and the free grant) rather than a reserved plan.
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-quoridor'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: environment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        // `auto` keeps HTTP/1.1 available, which is what the WebSocket upgrade
        // needs; `http2` would break it.
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      // The image is public on ghcr.io, so no registry credentials are needed.
    }
    template: {
      containers: [
        {
          name: 'server'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'STORAGE_ACCOUNT_NAME'
              value: storage.name
            }
            {
              name: 'ALLOWED_ORIGINS'
              value: 'https://${site.properties.defaultHostname}'
            }
            {
              name: 'RECONNECT_GRACE_MS'
              value: string(reconnectGraceMs)
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
              }
              initialDelaySeconds: 3
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        // Exactly one replica: rooms live in process and are only snapshotted
        // to Table Storage, so a second replica would not see them. Scaling to
        // zero is what keeps this inside the free grant.
        minReplicas: 0
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}

// The server reads and writes room snapshots with its own managed identity, so
// no connection string is ever stored.
resource appTableAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, tableDataContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', tableDataContributorRoleId)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Deploy identity permissions are pinned to the two resources it actually
// publishes to, rather than the resource group.
resource deployAppAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: app
  name: guid(app.id, deployIdentityPrincipalId, contributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributorRoleId)
    principalId: deployIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Static Web Apps has no OIDC-native upload path: the deploy action needs the
// site's API key. `deploy-web.yml` reads it at run time with this grant instead
// of keeping a copy in GitHub secrets.
resource deploySiteAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: site
  name: guid(site.id, deployIdentityPrincipalId, contributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', contributorRoleId)
    principalId: deployIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output serverUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output siteUrl string = 'https://${site.properties.defaultHostname}'
output storageAccount string = storage.name
