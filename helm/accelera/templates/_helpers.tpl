{{/*
Expand the name of the chart.
*/}}
{{- define "accelera.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "accelera.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version for chart label.
*/}}
{{- define "accelera.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "accelera.labels" -}}
helm.sh/chart: {{ include "accelera.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: accelera
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/*
Frontend selector labels
*/}}
{{- define "accelera.frontend.selectorLabels" -}}
app.kubernetes.io/name: {{ include "accelera.name" . }}-frontend
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
GPU Exporter selector labels
*/}}
{{- define "accelera.gpuExporter.selectorLabels" -}}
app.kubernetes.io/name: {{ include "accelera.name" . }}-gpu-exporter
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Frontend image
*/}}
{{- define "accelera.frontend.image" -}}
{{- printf "%s:%s" .Values.frontend.image.repository (.Values.frontend.image.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
GPU Exporter image
*/}}
{{- define "accelera.gpuExporter.image" -}}
{{- printf "%s:%s" .Values.gpuExporter.image.repository (.Values.gpuExporter.image.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
Image pull secrets
*/}}
{{- define "accelera.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- range . }}
  - name: {{ . }}
  {{- end }}
{{- end }}
{{- end }}

{{/*
ServiceAccount name for GPU exporter
*/}}
{{- define "accelera.gpuExporter.serviceAccountName" -}}
{{ include "accelera.fullname" . }}-gpu-exporter
{{- end }}
