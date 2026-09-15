FROM public.ecr.aws/lambda/python:3.11

# Copy dependencies
COPY requirements.txt .
RUN pip install -r requirements.txt -t ${LAMBDA_TASK_ROOT}

# Copy code
COPY app.py ${LAMBDA_TASK_ROOT}/
COPY src/ ${LAMBDA_TASK_ROOT}/src/

CMD [ "app.handler" ]
