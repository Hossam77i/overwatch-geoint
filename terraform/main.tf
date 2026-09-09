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
      Action   = ["dynamodb:PutItem"]
      Effect   = "Allow"
      Resource = "arn:aws:dynamodb:us-east-1:538675137281:table/cloud-resume-threats"
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
  image_uri     = "538675137281.dkr.ecr.us-east-1.amazonaws.com/overwatch-geoint:latest"
  timeout       = 60
  memory_size   = 1024
}

# EventBridge Rule to run every morning at 8:00 AM UTC
resource "aws_cloudwatch_event_rule" "daily_trigger" {
  name                = "overwatch-daily-trigger"
  description         = "Trigger Overwatch GEOINT daily"
  schedule_expression = "cron(0 8 * * ? *)"
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
}
resource "aws_apigatewayv2_stage" "default_stage" {
  api_id      = aws_apigatewayv2_api.geoint_api.id
  name        = "$default"
  auto_deploy = true
}
resource "aws_apigatewayv2_integration" "lambda_integration" {
  api_id           = aws_apigatewayv2_api.geoint_api.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.overwatch_lambda.invoke_arn
  integration_method = "POST"
}
resource "aws_apigatewayv2_route" "trigger_route" {
  api_id    = aws_apigatewayv2_api.geoint_api.id
  route_key = "GET /trigger-overwatch"
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
