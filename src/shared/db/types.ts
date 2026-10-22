
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"entity": string,"entity_id": string | null,"id": string,"organization_id": string | null,"payload": NonNullable<Json>
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: string,"organization_id"?: string | null,"payload"?: NonNullable<Json>
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: string,"organization_id"?: string | null,"payload"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expiry_warning_days": number | null,"id": string,"name": string,"organization_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expiry_warning_days"?: number | null,"id"?: string,"name": string,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expiry_warning_days"?: number | null,"id"?: string,"name"?: string,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"locations": {
                  Row: {
                    "address": string | null,"created_at": string,"created_by": string | null,"id": string,"last_sale_number": number,"name": string,"organization_id": string,"status": string,"timezone": string | null
                  }
                  Insert: {
                    "address"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_sale_number"?: number,"name": string,"organization_id": string,"status"?: string,"timezone"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"last_sale_number"?: number,"name"?: string,"organization_id"?: string,"status"?: string,"timezone"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "locations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"membership_locations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"location_id": string,"membership_id": string,"organization_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"location_id": string,"membership_id": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"location_id"?: string,"membership_id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "membership_locations_location_fkey"
      columns: ["location_id","organization_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "membership_locations_membership_fkey"
      columns: ["membership_id","organization_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"organization_id": string,"role": string,"status": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"organization_id": string,"role": string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"organization_id"?: string,"role"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "cash_difference_tolerance": number,"created_at": string,"created_by": string | null,"expiry_critical_days": number,"expiry_warning_days": number,"id": string,"name": string,"sale_void_window_minutes": number,"slow_mover_days": number,"slug": string,"status": string,"timezone": string
                  }
                  Insert: {
                    "cash_difference_tolerance"?: number,"created_at"?: string,"created_by"?: string | null,"expiry_critical_days"?: number,"expiry_warning_days"?: number,"id"?: string,"name": string,"sale_void_window_minutes"?: number,"slow_mover_days"?: number,"slug": string,"status"?: string,"timezone"?: string
                  }
                  Update: {
                    "cash_difference_tolerance"?: number,"created_at"?: string,"created_by"?: string | null,"expiry_critical_days"?: number,"expiry_warning_days"?: number,"id"?: string,"name"?: string,"sale_void_window_minutes"?: number,"slow_mover_days"?: number,"slug"?: string,"status"?: string,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"price_changes": {
                  Row: {
                    "bulk_update_id": string | null,"changed_at": string,"changed_by": string | null,"id": string,"import_id": string | null,"new_price": number,"old_price": number | null,"organization_id": string,"product_id": string,"source": string
                  }
                  Insert: {
                    "bulk_update_id"?: string | null,"changed_at"?: string,"changed_by"?: string | null,"id"?: string,"import_id"?: string | null,"new_price": number,"old_price"?: number | null,"organization_id": string,"product_id": string,"source": string
                  }
                  Update: {
                    "bulk_update_id"?: string | null,"changed_at"?: string,"changed_by"?: string | null,"id"?: string,"import_id"?: string | null,"new_price"?: number,"old_price"?: number | null,"organization_id"?: string,"product_id"?: string,"source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "price_changes_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "price_changes_product_id_organization_id_fkey"
      columns: ["product_id","organization_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"product_barcodes": {
                  Row: {
                    "barcode_key": string | null,"barcode_norm": string,"barcode_raw": string | null,"created_at": string,"created_by": string | null,"id": string,"is_primary": boolean,"organization_id": string,"product_id": string,"updated_at": string
                  }
                  Insert: {
                    "barcode_key"?: never,"barcode_norm": string,"barcode_raw"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_primary"?: boolean,"organization_id": string,"product_id": string,"updated_at"?: string
                  }
                  Update: {
                    "barcode_key"?: never,"barcode_norm"?: string,"barcode_raw"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"is_primary"?: boolean,"organization_id"?: string,"product_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_barcodes_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_barcodes_product_id_organization_id_fkey"
      columns: ["product_id","organization_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"product_location_settings": {
                  Row: {
                    "created_at": string,"created_by": string | null,"location_id": string,"min_stock": number | null,"organization_id": string,"product_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"location_id": string,"min_stock"?: number | null,"organization_id": string,"product_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"location_id"?: string,"min_stock"?: number | null,"organization_id"?: string,"product_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_location_settings_location_id_organization_id_fkey"
      columns: ["location_id","organization_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "product_location_settings_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_location_settings_product_id_organization_id_fkey"
      columns: ["product_id","organization_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"products": {
                  Row: {
                    "brand": string | null,"category_id": string | null,"created_at": string,"created_by": string | null,"id": string,"name": string,"organization_id": string,"preferred_supplier_id": string | null,"quick_sale_label": string | null,"quick_sale_position": number | null,"reference_cost": number | null,"reference_cost_source": string | null,"reference_cost_updated_at": string | null,"sale_price": number | null,"sale_price_updated_at": string | null,"status": string,"tracks_expiry": boolean,"tracks_stock": boolean,"unit": string,"updated_at": string
                  }
                  Insert: {
                    "brand"?: string | null,"category_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"organization_id": string,"preferred_supplier_id"?: string | null,"quick_sale_label"?: string | null,"quick_sale_position"?: number | null,"reference_cost"?: number | null,"reference_cost_source"?: string | null,"reference_cost_updated_at"?: string | null,"sale_price"?: number | null,"sale_price_updated_at"?: string | null,"status"?: string,"tracks_expiry"?: boolean,"tracks_stock"?: boolean,"unit"?: string,"updated_at"?: string
                  }
                  Update: {
                    "brand"?: string | null,"category_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"preferred_supplier_id"?: string | null,"quick_sale_label"?: string | null,"quick_sale_position"?: number | null,"reference_cost"?: number | null,"reference_cost_source"?: string | null,"reference_cost_updated_at"?: string | null,"sale_price"?: number | null,"sale_price_updated_at"?: string | null,"status"?: string,"tracks_expiry"?: boolean,"tracks_stock"?: boolean,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_organization_id_fkey"
      columns: ["category_id","organization_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "products_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_preferred_supplier_id_organization_id_fkey"
      columns: ["preferred_supplier_id","organization_id"]
isOneToOne: false
      referencedRelation: "suppliers"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string | null,"id": string
                  }
                  Insert: {
                    "created_at"?: string,"full_name"?: string | null,"id": string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string | null,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"suppliers": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"name": string,"notes": string | null,"organization_id": string,"phone": string | null,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"notes"?: string | null,"organization_id": string,"phone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"notes"?: string | null,"organization_id"?: string,"phone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppliers_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "create_location":
{ Args: { "p_address"?: string,"p_name": string,"p_organization_id": string }; Returns: {
              "address": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"last_sale_number": number,
"name": string,
"organization_id": string,
"status": string,
"timezone": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "locations"
        isOneToOne: true
        isSetofReturn: false
      } },
"create_organization":
{ Args: { "p_name": string,"p_slug": string,"p_timezone"?: string }; Returns: {
              "cash_difference_tolerance": number,
"created_at": string,
"created_by": string | null,
"expiry_critical_days": number,
"expiry_warning_days": number,
"id": string,
"name": string,
"sale_void_window_minutes": number,
"slow_mover_days": number,
"slug": string,
"status": string,
"timezone": string
            }
                          SetofOptions: {
        from: "*"
        to: "organizations"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_initial_sale_price":
{ Args: { "p_product_id": string,"p_sale_price": number }; Returns: {
              "brand": string | null,
"category_id": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"name": string,
"organization_id": string,
"preferred_supplier_id": string | null,
"quick_sale_label": string | null,
"quick_sale_position": number | null,
"reference_cost": number | null,
"reference_cost_source": string | null,
"reference_cost_updated_at": string | null,
"sale_price": number | null,
"sale_price_updated_at": string | null,
"status": string,
"tracks_expiry": boolean,
"tracks_stock": boolean,
"unit": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "products"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
