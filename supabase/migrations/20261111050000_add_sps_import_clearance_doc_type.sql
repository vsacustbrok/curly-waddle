-- SPS import clearances are checked against the bill of lading, so they get their own document type.
alter table public.job_documents drop constraint job_documents_doc_type_check;
alter table public.job_documents add constraint job_documents_doc_type_check check (doc_type = any (array[
  'bill_of_lading', 'airway_bill', 'commercial_invoice', 'packing_list', 'sps_import_clearance', 'permit', 'entry',
  'assessment', 'payment_proof', 'release', 'delivery_receipt', 'billing_statement', 'other'
]));
