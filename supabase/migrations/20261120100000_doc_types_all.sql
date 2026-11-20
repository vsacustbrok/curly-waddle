-- Every document type the app and the reader use can be saved. The list here had fallen behind
-- (sea waybills, telex releases, certificates, permits...), so readings of those were refused.
-- Keep in sync with DOC_TYPES in src/lib/types.ts.
alter table public.job_documents drop constraint if exists job_documents_doc_type_check;
alter table public.job_documents add constraint job_documents_doc_type_check check (doc_type = any (array[
  'bill_of_lading', 'seaway_bill', 'telex_release', 'airway_bill',
  'commercial_invoice', 'sales_contract', 'purchase_order', 'packing_list', 'container_list', 'payment_proof',
  'bank_document', 'insurance_certificate',
  'sps_import_clearance', 'mav_certificate', 'fda_permit', 'peza_permit', 'agency_permit', 'health_certificate',
  'phytosanitary_certificate', 'halal_certificate', 'fumigation_certificate', 'certificate_of_origin', 'importer_accreditation', 'permit',
  'arrival_notice', 'entry', 'assessment', 'release', 'delivery_receipt',
  'billing_statement', 'other'
]::text[]));
