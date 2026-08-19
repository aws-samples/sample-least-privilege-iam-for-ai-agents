# Security

## Disclaimer

This project is sample code provided for demonstration and educational purposes only. It is **NOT** intended for direct production deployment without additional security hardening, testing, and customization specific to your organization's requirements.

## Reporting Vulnerabilities

If you discover a potential security issue in this project, please report it to AWS Security via email at [aws-security@amazon.com](mailto:aws-security@amazon.com). Please do **not** create a public GitHub issue for security vulnerabilities.

## AWS Services Used

This project deploys and interacts with the following AWS services:

| Service | Security-Relevant Role |
|---------|----------------------|
| AWS CloudTrail | Event source — captures API call metadata for the observed IAM role |
| Amazon EventBridge | Filters and routes CloudTrail events to the collector Lambda |
| AWS Lambda | Processes and normalizes CloudTrail events; requires `s3:PutObject` only |
| Amazon S3 | Stores observation data (encrypted, versioned, public access blocked) |
| AWS Step Functions | Orchestrates policy analysis workflows |
| Amazon SNS | Delivers drift alert notifications |
| Amazon DynamoDB | Stores trace data with TTL-based expiration (Problem 2) |

## Known Security Considerations

The following items are known limitations of this sample code and should be addressed before any production deployment:

1. **S3 encryption uses SSE-S3 (AES-256) instead of a customer-managed KMS key.** SSE-S3 is sufficient for sample code but does not provide customer-controlled key rotation, key access auditing via CloudTrail, or the ability to revoke access by disabling the key.

2. **Demo sample data contains policies with `Resource: "*"`.** The files in `demo/sample-data/` intentionally include overly-broad policies as *input* to demonstrate how AgentGuard detects and remediates over-permissioned roles. These are not templates to copy — they represent the "before" state.

3. **Access log bucket does not have its own access logging enabled.** This is standard for sample projects to avoid infinite logging loops, but production deployments should enable access logging on all buckets.

4. **No Bedrock Guardrails integration is demonstrated.** If your AI agent uses Amazon Bedrock, you should independently configure [Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html) to control model inputs and outputs. AgentGuard observes API-level behavior only and does not enforce content-level safety.

5. **No compliance-specific guidance is provided.** If your AI agent processes regulated data (PCI-DSS, HIPAA, SOC 2, etc.), you are responsible for ensuring the observation and storage infrastructure meets your compliance obligations. This includes encryption key management, data residency, audit logging, and retention policies.

## Production Hardening Recommendations

Before deploying this pattern in a production environment, implement the following:

### Encryption
- Replace SSE-S3 with a customer-managed AWS KMS key with automatic key rotation enabled:
  ```typescript
  const trailKey = new kms.Key(this, 'TrailKey', {
    enableKeyRotation: true,
    description: 'CMK for AgentGuard observation data',
  });
  ```
- Use the same KMS key (or a dedicated one) for SNS topic encryption and DynamoDB table encryption.

### Access Controls
- Restrict the CDK deployment role to the minimum permissions required.
- Enable MFA delete on the observation S3 bucket for compliance-critical environments.
- Add an S3 bucket policy that explicitly denies unencrypted uploads (`aws:SecureTransport`).

### Monitoring and Logging
- Enable S3 access logging on the observation bucket (route to a dedicated logging bucket).
- Enable AWS CloudTrail data events for the observation bucket itself to audit who reads observation data.
- Set up CloudWatch alarms for Lambda errors, Step Functions failures, and SNS delivery failures.

### Network
- If the self-update Lambda is deployed in a VPC, configure a NAT gateway or VPC endpoint for outbound HTTPS access to `raw.githubusercontent.com`.
- Consider deploying Lambda functions in a VPC with no inbound internet access for defense in depth.

### Agent Safety
- Configure [Amazon Bedrock Guardrails](https://docs.aws.amazon.com/bedrock/latest/userguide/guardrails.html) independently to control model behavior at the content level.
- Use IAM permission boundaries in addition to identity-based policies for defense in depth.

### Data Lifecycle
- Review and adjust the S3 lifecycle policy retention period (default: 90 days) based on your compliance and operational requirements.
- Ensure DynamoDB TTL settings align with your data retention policies.

## Shared Responsibility

Security and compliance are shared responsibilities between AWS and the customer. This sample code deploys infrastructure in *your* AWS account. You are responsible for:

- Configuring appropriate access controls for your environment
- Ensuring compliance with your organization's security policies
- Regularly updating dependencies and applying security patches
- Monitoring deployed resources for anomalous activity
- Managing and rotating credentials used by the deployed infrastructure
