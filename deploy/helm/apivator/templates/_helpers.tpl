{{- define "apivator.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "apivator.fullname" -}}
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

{{- define "apivator.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "apivator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{/* Çağrı: include "apivator.selector" (dict "root" . "component" "api") */}}
{{- define "apivator.selector" -}}
app.kubernetes.io/name: {{ include "apivator.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "apivator.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "apivator.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "apivator.secretName" -}}
{{- default (printf "%s-secrets" (include "apivator.fullname" .)) .Values.existingSecret }}
{{- end }}

{{- define "apivator.apiImage" -}}
{{- printf "%s:%s" .Values.api.image.repository (default .Chart.AppVersion .Values.api.image.tag) }}
{{- end }}

{{- define "apivator.webImage" -}}
{{- printf "%s:%s" .Values.web.image.repository (default .Chart.AppVersion .Values.web.image.tag) }}
{{- end }}

{{/* Birden fazla API replica'sı (HPA dahil) çalışabilirse "true", yoksa boş. */}}
{{- define "apivator.multiReplica" -}}
{{- if or (gt (int .Values.api.replicaCount) 1) (and .Values.api.autoscaling.enabled (gt (int .Values.api.autoscaling.maxReplicas) 1)) -}}true{{- end -}}
{{- end }}

{{/* ingress.apiRouting=web ise istemci IP'si iki proxy arkasından okunur (ingress + nginx). */}}
{{- define "apivator.forwardLimit" -}}
{{- if eq .Values.ingress.apiRouting "web" }}{{ max 2 (int .Values.api.forwardLimit) }}{{ else }}{{ int .Values.api.forwardLimit }}{{ end }}
{{- end }}

{{/* Girdi doğrulamaları: yanlış yapılandırma kurulumda anlaşılır bir hatayla durdurulur. */}}
{{- define "apivator.validate" -}}
{{- if not .Values.publicUrl }}{{ fail "publicUrl zorunlu (örn. https://apivator.sirket.com)" }}{{ end }}
{{- if not .Values.externalDatabase.host }}{{ fail "externalDatabase.host zorunlu: chart PostgreSQL kurmaz, mevcut bir PostgreSQL 16+ adresi verin" }}{{ end }}
{{- if and (include "apivator.multiReplica" .) (not .Values.externalRedis.host) }}
{{- fail "api.replicaCount > 1 (ya da api.autoscaling açık) iken externalRedis.host zorunlu: Redis backplane olmadan canlı güncellemeler yalnızca aynı pod'a bağlı kullanıcılara ulaşır" }}
{{- end }}
{{- /* Parola bağlantı dizgisine olduğu gibi yazılır: ayırıcı karakterler başka seçenek enjekte edebilir. */}}
{{- if regexMatch "[;\"'=]" (toString .Values.secrets.dbPassword) }}{{ fail "secrets.dbPassword ; \" ' = karakterlerini içeremez (bağlantı dizgisi bozulur); hex/base64 kullanın" }}{{ end }}
{{- if regexMatch "[,\"' ]" (toString .Values.secrets.redisPassword) }}{{ fail "secrets.redisPassword , \" ' ve boşluk içeremez; hex/base64 kullanın" }}{{ end }}
{{- if not .Values.existingSecret }}
{{- if lt (len .Values.secrets.jwtSigningKey) 32 }}{{ fail "secrets.jwtSigningKey en az 32 karakter olmalı (ya da existingSecret verin)" }}{{ end }}
{{- if not .Values.secrets.dbPassword }}{{ fail "secrets.dbPassword zorunlu (ya da existingSecret verin)" }}{{ end }}
{{- end }}
{{- if and .Values.smtp.enabled (eq .Values.email.mode "Smtp") (or (not .Values.smtp.host) (not .Values.smtp.fromAddress)) }}
{{- fail "email.mode=Smtp iken smtp.host ve smtp.fromAddress zorunlu (SMTP ayarsız kurmak için smtp.enabled=false)" }}
{{- end }}
{{- if and .Values.ingress.enabled (not .Values.ingress.host) }}{{ fail "ingress.host zorunlu (ya da ingress.enabled=false)" }}{{ end }}
{{- if not (has .Values.migration.mode (list "job" "startup" "none")) }}{{ fail "migration.mode job, startup ya da none olmalı" }}{{ end }}
{{- if not (has .Values.ingress.apiRouting (list "api" "web")) }}{{ fail "ingress.apiRouting api ya da web olmalı" }}{{ end }}
{{- end }}

{{/* Veritabanı değişkenleri (sıra önemli: $(VAR) yalnızca kendinden önceki değişkenleri okur). */}}
{{- define "apivator.dbEnv" -}}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "apivator.secretName" . }}
      key: db-password
- name: ConnectionStrings__Postgres
  value: {{ printf "Host=%s;Port=%v;Database=%s;Username=%s;Password=$(DB_PASSWORD)%s%s" .Values.externalDatabase.host .Values.externalDatabase.port .Values.externalDatabase.database .Values.externalDatabase.username (ternary (printf ";SSL Mode=%s" .Values.externalDatabase.sslMode) "" (ne .Values.externalDatabase.sslMode "")) (ternary (printf ";%s" .Values.externalDatabase.extraOptions) "" (ne .Values.externalDatabase.extraOptions "")) | quote }}
{{- end }}

{{- define "apivator.apiEnv" -}}
{{ include "apivator.dbEnv" . }}
- name: Jwt__SigningKey
  valueFrom:
    secretKeyRef:
      name: {{ include "apivator.secretName" . }}
      key: jwt-signing-key
{{- if .Values.smtp.enabled }}
- name: Smtp__Password
  valueFrom:
    secretKeyRef:
      name: {{ include "apivator.secretName" . }}
      key: smtp-password
      optional: true
{{- end }}
{{- if .Values.externalRedis.host }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "apivator.secretName" . }}
      key: redis-password
      optional: true
- name: Redis__ConnectionString
  value: {{ printf "%s:%v,password=$(REDIS_PASSWORD)%s" .Values.externalRedis.host .Values.externalRedis.port (ternary ",ssl=true" "" .Values.externalRedis.ssl) | quote }}
{{- end }}
{{- with .Values.api.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end }}
