// Bootstrap: deployment identity for GitHub Actions (OIDC, secretless).
// Deployed once, manually, into a dedicated resource group so the deploy
// identity is isolated from the workload resources.
//
//   az deployment group create -g rg-quoridor-bootstrap -f infra/bootstrap.bicep
//
// Docs: https://learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect

targetScope = 'resourceGroup'

@description('Azure region for the managed identity.')
param location string = resourceGroup().location

@description('GitHub repository in "owner/repo" form.')
param githubRepository string = 'aktsmm/quoridor-online'

@description('Protected GitHub Environment the deploy workflows run in.')
param githubEnvironment string = 'production'

resource deployIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-quoridor-deploy'
  location: location
}

// Subject must match the GitHub Actions token exactly. Binding it to a
// protected Environment (rather than a branch) means deployments go through
// the environment's approval/branch rules first.
resource environmentCredential 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deployIdentity
  name: 'github-env-${githubEnvironment}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    subject: 'repo:${githubRepository}:environment:${githubEnvironment}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

output identityName string = deployIdentity.name
output clientId string = deployIdentity.properties.clientId
output principalId string = deployIdentity.properties.principalId
output tenantId string = deployIdentity.properties.tenantId
