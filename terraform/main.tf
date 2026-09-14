data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
}

provider "aws" {
  region = "us-east-1"
}

# IAM Role for Lambda
resource "aws_iam_role" "geoint_lambda_role" {
  name = "overwatch_geoint_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.geoint_lambda_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Allow Lambda to write to the cloud-resume-threats DynamoDB table
resource "aws_iam_policy" "dynamodb_write" {
  name        = "overwatch_dynamodb_write"
  description = "Allow overwatch to publish threats"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = ["dynamodb:PutItem", "dynamodb:Scan"]
      Effect   = "Allow"
      Resource = "arn:aws:dynamodb:${local.region}:${local.account_id}:table/cloud-resume-threats"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_dynamodb" {
  role       = aws_iam_role.geoint_lambda_role.name
  policy_arn = aws_iam_policy.dynamodb_write.arn
}

# The Lambda Function using the Docker Image
resource "aws_lambda_function" "overwatch_lambda" {
  function_name = "overwatch_geoint_pipeline"
  role          = aws_iam_role.geoint_lambda_role.arn
  package_type  = "Image"
  image_uri     = "${local.account_id}.dkr.ecr.${local.region}.amazonaws.com/overwatch-geoint:latest"
  timeout       = 300
  memory_size   = 1024
  environment {
    variables = {
      S3_BUCKET            = aws_s3_bucket.site.bucket
      DYNAMODB_INFRA_CACHE = aws_dynamodb_table.infra_cache.name
      DYNAMODB_THREATS     = "cloud-resume-threats"
      AWS_REGION           = local.region
    }
  }
}

# EventBridge Rule to run every morning at 8:00 AM UTC
resource "aws_cloudwatch_event_rule" "daily_trigger" {
  name                = "overwatch-daily-trigger"
  description         = "Triggers the Overwatch GEOINT pipeline every 6 hours to rotate through 15 countries"
  schedule_expression = "rate(6 hours)"
}

resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.daily_trigger.name
  target_id = "OverwatchLambda"
  arn       = aws_lambda_function.overwatch_lambda.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.overwatch_lambda.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_trigger.arn
}

# API Gateway to trigger it manually via URL (for demonstration)
resource "aws_apigatewayv2_api" "geoint_api" {
  name          = "overwatch_geoint_api"
  protocol_type = "HTTP"
  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type"]
  }
}

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/api_gw/${aws_apigatewayv2_api.geoint_api.name}"
  retention_in_days = 30
}

resource "aws_apigatewayv2_stage" "default_stage" {
  api_id      = aws_apigatewayv2_api.geoint_api.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw.arn
    format          = "{ \"requestId\":\"$context.requestId\", \"ip\": \"$context.identity.sourceIp\", \"requestTime\":\"$context.requestTime\", \"httpMethod\":\"$context.httpMethod\", \"routeKey\":\"$context.routeKey\", \"status\":\"$context.status\", \"protocol\":\"$context.protocol\", \"responseLength\":\"$context.responseLength\" }"
  }
}

resource "aws_apigatewayv2_integration" "lambda_integration" {
  api_id             = aws_apigatewayv2_api.geoint_api.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.overwatch_lambda.invoke_arn
  integration_method = "POST"
}
resource "aws_apigatewayv2_route" "trigger_route" {
  api_id    = aws_apigatewayv2_api.geoint_api.id
  route_key = "GET /trigger-overwatch"
  target    = "integrations/${aws_apigatewayv2_integration.lambda_integration.id}"
}
resource "aws_apigatewayv2_route" "trigger_route_post" {
  api_id    = aws_apigatewayv2_api.geoint_api.id
  route_key = "POST /trigger-overwatch"
  target    = "integrations/${aws_apigatewayv2_integration.lambda_integration.id}"
}
resource "aws_lambda_permission" "api_gw_invoke" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.overwatch_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.geoint_api.execution_arn}/*/*"
}
output "manual_trigger_url" {
  value = "${aws_apigatewayv2_api.geoint_api.api_endpoint}/trigger-overwatch"
}

# Allow Lambda to write to the S3 bucket to save the annotated images
resource "aws_iam_policy" "s3_write" {
  name        = "overwatch_s3_write"
  description = "Allow overwatch to publish annotated images to S3"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = ["s3:PutObject", "s3:PutObjectAcl"]
      Effect   = "Allow"
      Resource = "arn:aws:s3:::hossam-cloud-resume-e4b1b23e/*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_s3" {
  role       = aws_iam_role.geoint_lambda_role.name
  policy_arn = aws_iam_policy.s3_write.arn
}

# 24h infra cache per country (Step 1: Egypt, then roll out)
resource "aws_dynamodb_table" "infra_cache" {
  name         = "overwatch-infra-cache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "country"
  attribute {
    name = "country"
    type = "S"
  }
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

resource "aws_iam_policy" "infra_cache_rw" {
  name        = "overwatch_infra_cache_rw"
  description = "Read/write 24h infra cache"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
      Effect   = "Allow"
      Resource = aws_dynamodb_table.infra_cache.arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_infra_cache" {
  role       = aws_iam_role.geoint_lambda_role.name
  policy_arn = aws_iam_policy.infra_cache_rw.arn
}

resource "aws_s3_bucket_public_access_block" "hossam_s3_block" {
  bucket                  = "hossam-cloud-resume-e4b1b23e"
  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}
