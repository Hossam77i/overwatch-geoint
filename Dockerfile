# Stage 1: Build dependencies
FROM public.ecr.aws/lambda/python:3.13 AS builder

COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# Stage 2: Final runtime image
FROM public.ecr.aws/lambda/python:3.13

# Set environment variables for security and performance
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Copy installed dependencies from builder stage
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

# Copy application code
COPY app.py ${LAMBDA_TASK_ROOT}/app.py
COPY src ${LAMBDA_TASK_ROOT}/src

# Switch to a non-root user (AWS Lambda runtime provides the 'sbx_user1051' or similar automatically, 
# but setting standard permissions is best practice)
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}

CMD [ "app.handler" ]
