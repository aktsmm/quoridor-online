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

@description('''
Subject prefix GitHub actually puts in the OIDC token. GitHub now issues
ID-qualified subjects (repo:<owner>@<ownerId>/<repo>@<repoId>), so the value
must be read from the repo rather than assumed:
  gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix
Leave empty to fall back to the classic "repo:owner/repo" form.
''')
param githubSubjectPrefix string = 'repo:aktsmm@71251920/quoridor-online@1315129369'

var subjectPrefix = empty(githubSubjectPrefix) ? 'repo:${githubRepository}' : githubSubjectPrefix

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
    subject: '${subjectPrefix}:environment:${githubEnvironment}'
    audiences: [
      'api://AzureADTokenExchange'
    ]
  }
}

output identityName string = deployIdentity.name
output clientId string = deployIdentity.properties.clientId
output principalId string = deployIdentity.properties.principalId
output tenantId string = deployIdentity.properties.tenantId
